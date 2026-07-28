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
import { jobLeads } from '@/lib/db/schema';
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

function revalidateScreening(leadId: string) {
  revalidatePath(`/roleproof/leads/${leadId}`);
  revalidatePath('/roleproof');
  revalidatePath('/roleproof/scoring-queue');
  revalidatePath('/profile/coach');
}

export async function runScreeningAction(leadId: string): Promise<StepReport[]> {
  const owner = await currentOwnerId();
  const lead = await requireScreenableLead(leadId, owner);
  const reports = await runScreening(leadId, owner);
  await recordActivity(owner, 'screening', { leadId, summary: `Screened “${lead.title}”` });
  // B → Coach bridge: a fresh screen may have raised misalignments / weak
  // requirements; surface them as enrich prompts immediately (engines 3 & 4).
  await generatePrompts(owner).catch(() => {});
  revalidateScreening(leadId);
  return reports;
}

/**
 * B1–B3 on demand. Normally fired automatically by createLead(); this is the
 * manual path for a lead that landed at `captured` because the capture-time call
 * failed, and the "Screen anyway" override for a lead the B1 gate held.
 */
export async function runInitialChecksAction(leadId: string): Promise<StepReport[]> {
  const owner = await currentOwnerId();
  const lead = await requireScreenableLead(leadId, owner);
  const reports = await runInitialChecks(leadId, owner);
  await recordActivity(owner, 'screening', { leadId, summary: `Initial checks · “${lead.title}”` });
  await generatePrompts(owner).catch(() => {});
  revalidateScreening(leadId);
  return reports;
}

/**
 * B4–B6 for one lead. Called in a sequential loop by the Ready-to-score batch
 * runner — one at a time, never Promise.all, so the calls land seconds apart and
 * actually hit B4–B6's cached system prompts. Safe to re-invoke from the top on
 * a stuck lead (B4/B6 overwrite, B5 skips re-extraction).
 */
export async function runScoringAction(leadId: string): Promise<StepReport[]> {
  const owner = await currentOwnerId();
  const lead = await requireScreenableLead(leadId, owner);
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
