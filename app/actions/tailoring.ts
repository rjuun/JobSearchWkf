'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { runEvidenceMapping, generateCv } from '@/lib/pipeline/tailoring';
import { db } from '@/lib/db';
import { requirementTailoring } from '@/lib/db/schema';
import type { StepReport } from '@/lib/pipeline/runs';
import { recordActivation } from '@/lib/activation';
import { recordActivity } from '@/lib/activity';
import { currentOwnerId } from '@/lib/auth';

export async function mapEvidenceAction(leadId: string): Promise<StepReport[]> {
  const owner = await currentOwnerId();
  const reports = await runEvidenceMapping(leadId, owner);
  revalidatePath(`/roleproof/leads/${leadId}`);
  return reports;
}

export async function setApprovalAction(
  rowId: string,
  status: 'pending' | 'green' | 'yellow' | 'red',
  leadId: string
): Promise<void> {
  const owner = await currentOwnerId();
  // Any evidence can be Kept; evidence outside the template slots simply routes
  // the CV to the programmatic builder at C6 (it is never stranded).
  const [prior] = await db
    .select({ s: requirementTailoring.approvalStatus })
    .from(requirementTailoring)
    .where(and(eq(requirementTailoring.id, rowId), eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, owner)));
  // M7 provenance: stamp approvedAt only on the transition INTO green (preserve the
  // original approval date across re-saves); clear it when un-kept.
  const set: { approvalStatus: typeof status; approvedAt?: Date | null } = { approvalStatus: status };
  if (status === 'green') {
    if (prior?.s !== 'green') set.approvedAt = new Date();
  } else {
    set.approvedAt = null;
  }
  await db
    .update(requirementTailoring)
    .set(set)
    .where(and(eq(requirementTailoring.id, rowId), eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, owner)));
  // Only count a Keep when it actually transitions INTO green — so toggling green→undo→green
  // doesn't inflate decisions-before-win / evidence-kept.
  if (status === 'green' && prior?.s !== 'green') {
    await recordActivation(owner, 'keep', { leadId });
    await recordActivity(owner, 'evidence_kept', { leadId, summary: 'Kept a piece of evidence onto a CV' });
  }
  revalidatePath(`/roleproof/leads/${leadId}`);
}

export async function generateCvAction(leadId: string): Promise<{ reports: StepReport[]; atsRating: number }> {
  const owner = await currentOwnerId();
  const { reports, atsRating } = await generateCv(leadId, owner);
  await recordActivation(owner, 'cv_generated', { leadId, meta: { atsRating } });
  await recordActivity(owner, 'cv_generated', { leadId, summary: `Tailored a CV · ATS ${atsRating}`, meta: { atsRating } });
  revalidatePath(`/roleproof/leads/${leadId}`);
  return { reports, atsRating };
}
