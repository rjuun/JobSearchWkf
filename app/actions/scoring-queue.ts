'use server';

/**
 * The screening gate's human decisions (Scoring Phase Redesign §2.2.E).
 *
 * Only leads B3/B4 actually flagged reach the Queue tab — clean leads were
 * auto-advanced to `selected` by runInitialChecks and never appear here. So
 * every row in the Queue is a genuine decision, and this action records it.
 *
 * "Triage" is the verb, never a surface name: the app already has an unrelated
 * R5 feature called Weekly Triage (components/roleproof/weekly-triage.tsx,
 * app/actions/triage.ts) that ranks leads already past scoring.
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobLeads } from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';
import { recordActivity } from '@/lib/activity';

/** The three outcomes available at the gate. `selected` feeds Ready to score. */
export type ScreeningGate = 'roadblocked' | 'misaligned' | 'selected';

const GATE_VERB: Record<ScreeningGate, string> = {
  roadblocked: 'Dropped (roadblocked)',
  misaligned: 'Dropped (misaligned)',
  selected: 'Selected for scoring',
};

// Both drop outcomes write the same terminal status — `not_pursued` — since
// 2026-07-30. The gate still asks *why* (roadblocked vs misaligned, for the
// activity log and the button the person clicked), but that reason already
// lives on the row as `roadblocks`/`misalignments`; the status column doesn't
// need to repeat it. See the leadStatusEnum comment in lib/db/schema.ts.
const GATE_STATUS: Record<ScreeningGate, 'not_pursued' | 'selected'> = {
  roadblocked: 'not_pursued',
  misaligned: 'not_pursued',
  selected: 'selected',
};

export async function setScreeningGateAction(leadId: string, status: ScreeningGate): Promise<void> {
  const owner = await currentOwnerId();
  const [lead] = await db
    .select({ title: jobLeads.title })
    .from(jobLeads)
    .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) throw new Error('Lead not found.');

  // updatedAt written explicitly — `base` has no $onUpdate.
  await db
    .update(jobLeads)
    .set({ status: GATE_STATUS[status], updatedAt: new Date() })
    .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));

  await recordActivity(owner, 'screening', { leadId, summary: `${GATE_VERB[status]} · “${lead.title}”` });

  revalidatePath('/roleproof/scoring-queue');
  revalidatePath('/roleproof');
  revalidatePath(`/roleproof/leads/${leadId}`);
}
