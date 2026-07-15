'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { runScreening, type StepReport } from '@/lib/pipeline/screening';
import { db } from '@/lib/db';
import { jobLeads } from '@/lib/db/schema';
import { readText } from '@/lib/storage';
import { currentOwnerId } from '@/lib/auth';
import { recordActivity } from '@/lib/activity';
import { generatePrompts } from '@/lib/coaching-queue';

/** Screening needs a real posting to read — a title alone produces noise, not
 *  judgment. Refuse early with a clear message rather than scoring an empty JD. */
export async function runScreeningAction(leadId: string): Promise<StepReport[]> {
  const owner = await currentOwnerId();
  const [lead] = await db.select().from(jobLeads).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) throw new Error('Lead not found.');
  const jd = lead.rawJdPath ? await readText(lead.rawJdPath).catch(() => '') : '';
  if (jd.trim().length < 80) {
    throw new Error('No job description captured for this lead yet — paste or re-capture the posting before screening.');
  }
  const reports = await runScreening(leadId, owner);
  await recordActivity(owner, 'screening', { leadId, summary: `Screened “${lead.title}”` });
  // B → Coach bridge: a fresh screen may have raised misalignments / weak
  // requirements; surface them as enrich prompts immediately (engines 3 & 4).
  await generatePrompts(owner).catch(() => {});
  revalidatePath(`/roleproof/leads/${leadId}`);
  revalidatePath('/roleproof');
  revalidatePath('/profile/coach');
  return reports;
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
