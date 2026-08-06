'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import {
  runScreening,
  runInitialChecks,
  runScoring,
  refreshFreshness,
  type StepReport,
} from '@/lib/pipeline/screening';
import { db } from '@/lib/db';
import { jobLeads, requirementTailoring } from '@/lib/db/schema';
import { rescreenBlocked } from '@/lib/db/types';
import { currentOwnerId } from '@/lib/auth';
import { recordActivity } from '@/lib/activity';
import { generatePrompts } from '@/lib/coaching-queue';

/** Screening needs a real posting to read — a title alone produces noise, not
 *  judgment. Refuse early with a clear message rather than scoring an empty JD. */
async function requireScreenableLead(leadId: string, owner: string) {
  const [lead] = await db.select().from(jobLeads).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) throw new Error('Lead not found.');
  const jd = lead.jdText ?? '';
  if (jd.trim().length < 80) {
    throw new Error('No job description captured for this lead yet — paste or re-capture the posting before screening.');
  }
  return lead;
}

/**
 * CI · Make C2 Build on B6 Instead of Re-Deriving the Map §2.4 option (3).
 * `refreshFreshnessAction` is the intended B1-only re-screen affordance — its own
 * doc comment says B2–B6 are judgments over static JD text, so re-running them
 * past `promoted` just re-spends LLM calls for the same answer, and if B2's
 * `tooThin` branch fires, resets review a human already gave. `force` is the
 * deliberate, confirmed override; `getRescreenImpactAction` gives the UI what it
 * needs to show the person what's at stake before they set it.
 */
function assertRescreenAllowed(lead: { status: string }, force: boolean) {
  if (!rescreenBlocked(lead.status, force)) return;
  throw new Error(
    `“${lead.status}” is past the screening phase — B2–B6 are judgments over static JD text, so re-running them ` +
      `would just re-spend LLM calls for the same answer, and may reset requirement→evidence rows you've already ` +
      `approved. Use “Refresh freshness” if the posting might be stale, or confirm you want to re-screen anyway.`
  );
}

function revalidateScreening(leadId: string) {
  revalidatePath(`/roleproof/leads/${leadId}`);
  revalidatePath('/roleproof');
  revalidatePath('/roleproof/scoring-queue');
  revalidatePath('/profile/coach');
}

export async function runScreeningAction(leadId: string, force = false): Promise<StepReport[]> {
  const owner = await currentOwnerId();
  const lead = await requireScreenableLead(leadId, owner);
  assertRescreenAllowed(lead, force);
  const reports = await runScreening(leadId, owner);
  await recordActivity(owner, 'screening', { leadId, summary: `Screened “${lead.title}”` });
  // B → Coach bridge: a fresh screen may have raised misalignments / weak
  // requirements; surface them as enrich prompts immediately (engines 3 & 4).
  await generatePrompts(owner).catch(() => {});
  revalidateScreening(leadId);
  return reports;
}

/**
 * B1–B4 on demand. Normally fired automatically by createLead(); this is the
 * manual path for a lead that landed at `captured` because the capture-time call
 * failed, and the "Screen anyway" override for a lead the B1 gate held. `force`
 * is a distinct override from the "Screen anyway" copy above — that one clears
 * B1's freshness hold; this one clears the §2.4 past-`promoted` gate.
 */
export async function runInitialChecksAction(leadId: string, force = false): Promise<StepReport[]> {
  const owner = await currentOwnerId();
  const lead = await requireScreenableLead(leadId, owner);
  assertRescreenAllowed(lead, force);
  const reports = await runInitialChecks(leadId, owner);
  await recordActivity(owner, 'screening', { leadId, summary: `Initial checks · “${lead.title}”` });
  await generatePrompts(owner).catch(() => {});
  revalidateScreening(leadId);
  return reports;
}

/**
 * B5/B6 for one lead. Called in a sequential loop by the Ready-to-score batch
 * runner — one at a time, never Promise.all, so the calls land seconds apart and
 * actually hit B5/B6's cached system prompts. Safe to re-invoke from the top on
 * a stuck lead (B4/B6 overwrite, B5 skips re-extraction) — the Ready-to-score
 * tab only ever calls this on `screening`/`selected` leads, so §2.4's gate below
 * is unreached in normal use today. Gated anyway for consistency with the other
 * two B-phase actions and because a promoted+ lead still gets nothing from a
 * re-score but a re-spent Opus call: B6's `requirement_evidence` rewrite can
 * only ever improve what C2 carries forward, never regress it once C2's merge
 * logic lands (CI · Make C2 Build on B6 §2.2), so there is no orphan risk here
 * the way there is for B2's re-extraction branch.
 */
export async function runScoringAction(leadId: string, force = false): Promise<StepReport[]> {
  const owner = await currentOwnerId();
  const lead = await requireScreenableLead(leadId, owner);
  assertRescreenAllowed(lead, force);
  const reports = await runScoring(leadId, owner);
  await recordActivity(owner, 'screening', { leadId, summary: `Scored “${lead.title}”` });
  await generatePrompts(owner).catch(() => {});
  revalidateScreening(leadId);
  return reports;
}

/**
 * B1 only. The re-screen affordance for a lead that has been sitting in the
 * queue — elapsed time is the only B1 input that changes, and B2–B6 are
 * judgments over static JD text, so re-running them would just re-spend LLM
 * calls for the same answer.
 */
export async function refreshFreshnessAction(leadId: string): Promise<StepReport> {
  const owner = await currentOwnerId();
  const report = await refreshFreshness(leadId, owner);
  revalidateScreening(leadId);
  return report;
}

/**
 * What's at stake if §2.4's gate is overridden — the UI shows this before the
 * person confirms a re-screen past `promoted`, per the CI note's requirement
 * for "a deliberate, warned action that states what will be discarded."
 */
export async function getRescreenImpactAction(
  leadId: string
): Promise<{ status: string; total: number; green: number }> {
  const owner = await currentOwnerId();
  const [lead] = await db
    .select({ status: jobLeads.status })
    .from(jobLeads)
    .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) throw new Error('Lead not found.');
  const rows = await db
    .select({ approvalStatus: requirementTailoring.approvalStatus })
    .from(requirementTailoring)
    .where(and(eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, owner)));
  return { status: lead.status, total: rows.length, green: rows.filter((r) => r.approvalStatus === 'green').length };
}

export async function promoteLeadAction(leadId: string): Promise<void> {
  const owner = await currentOwnerId();
  await db.update(jobLeads).set({ status: 'promoted' }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  revalidatePath(`/roleproof/leads/${leadId}`);
  revalidatePath('/roleproof');
}

/**
 * Flag / unflag a role as a target (M1). Flagging grows the strength meter's relevancy
 * denominator (visible headroom) and pulls the role's Core/Important requirements into
 * the coach queue; regenerate the queue so that change is immediate.
 */
export async function toggleTargetAction(leadId: string): Promise<boolean> {
  const owner = await currentOwnerId();
  const [lead] = await db
    .select({ isTarget: jobLeads.isTarget, title: jobLeads.title })
    .from(jobLeads)
    .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) throw new Error('Lead not found.');
  const next = !lead.isTarget;
  await db.update(jobLeads).set({ isTarget: next }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (next) await recordActivity(owner, 'target_flagged', { leadId, summary: `Flagged “${lead.title}” as a target` });
  await generatePrompts(owner).catch(() => {});
  revalidatePath(`/roleproof/leads/${leadId}`);
  revalidatePath('/roleproof');
  revalidatePath('/profile');
  revalidatePath('/profile/coach');
  return next;
}
