'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { runEvidenceMapping, generateCv } from '@/lib/pipeline/tailoring';
import { db } from '@/lib/db';
import { requirementTailoring } from '@/lib/db/schema';
import type { StepReport } from '@/lib/pipeline/runs';
import { recordActivation } from '@/lib/activation';
import { recordActivity } from '@/lib/activity';
import { currentOwnerId } from '@/lib/auth';
import { evidenceNeedsCvSlot } from '@/lib/cv-slots';

export async function mapEvidenceAction(leadId: string): Promise<StepReport[]> {
  const owner = await currentOwnerId();
  const reports = await runEvidenceMapping(leadId, owner);
  revalidatePath(`/roleproof/leads/${leadId}`);
  return reports;
}

/**
 * Approve the entire evidence map in one shot — replaces the row-by-row
 * Keep/Maybe/Drop triage (retired per the owner's request: reviewing 16 rows
 * one at a time when the whole map is visible below is a redundant step).
 * The old single-row `setApprovalAction` was deleted (2026-08-06) once confirmed
 * dead — nothing called it after this replaced it; rebuild from this function
 * and its call sites if a per-row path is ever needed again.
 *
 * Approves every not-yet-green row that has a valid CV template slot (a row
 * can only be Kept once it has somewhere on the CV to land — it is never
 * stranded, it just can't be marked Kept without a slot). Rows without a slot
 * are left `pending` and reported back as skipped rather than silently ignored.
 */
export async function approveAllAction(leadId: string): Promise<{ approved: number; skipped: number }> {
  const owner = await currentOwnerId();
  const rows = await db
    .select({
      id: requirementTailoring.id,
      approvalStatus: requirementTailoring.approvalStatus,
      cvPosition: requirementTailoring.cvPosition,
      evidenceKind: requirementTailoring.evidenceKind,
    })
    .from(requirementTailoring)
    .where(and(eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, owner)));

  // Education/Language kind rows never get a cvPosition (no such CV_SLOTS entry
  // exists) — they're exempt from the slot requirement rather than stranded.
  const hasSlotOrExempt = (r: (typeof rows)[number]) => !evidenceNeedsCvSlot(r.evidenceKind) || !!r.cvPosition;
  const toApprove = rows.filter((r) => r.approvalStatus !== 'green' && hasSlotOrExempt(r));
  const skipped = rows.filter((r) => r.approvalStatus !== 'green' && !hasSlotOrExempt(r)).length;

  if (toApprove.length > 0) {
    await db
      .update(requirementTailoring)
      .set({ approvalStatus: 'green', approvedAt: new Date() })
      .where(
        and(
          eq(requirementTailoring.jobLeadId, leadId),
          eq(requirementTailoring.ownerId, owner),
          ne(requirementTailoring.approvalStatus, 'green'),
          inArray(
            requirementTailoring.id,
            toApprove.map((r) => r.id)
          )
        )
      );
    // One decision, not N: approving the whole map is a single judgement call,
    // not `toApprove.length` separate ones — recorded that way so decisions-
    // before-win reflects what the person actually did.
    await recordActivation(owner, 'keep', { leadId, meta: { bulk: true, count: toApprove.length } });
    await recordActivity(owner, 'evidence_kept', {
      leadId,
      summary: `Approved the entire evidence map (${toApprove.length} item${toApprove.length === 1 ? '' : 's'})`,
      meta: { bulk: true, count: toApprove.length },
    });
  }
  revalidatePath(`/roleproof/leads/${leadId}`);
  return { approved: toApprove.length, skipped };
}

export async function generateCvAction(leadId: string): Promise<{ reports: StepReport[]; atsRating: number }> {
  const owner = await currentOwnerId();
  const { reports, atsRating } = await generateCv(leadId, owner);
  await recordActivation(owner, 'cv_generated', { leadId, meta: { atsRating } });
  await recordActivity(owner, 'cv_generated', { leadId, summary: `Tailored a CV · ATS ${atsRating}`, meta: { atsRating } });
  revalidatePath(`/roleproof/leads/${leadId}`);
  return { reports, atsRating };
}
