'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobLeads, jobRequirements } from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';
import { archetypeByKey } from '@/lib/archetypes';
import { generatePrompts } from '@/lib/coaching-queue';
import { recordActivity } from '@/lib/activity';
import { recordUxEvent } from '@/lib/ux-events';

/**
 * C2 · Flag an Unexpected Door as a target. Reuses B3's `is_target`: it
 * materialises the archetype into a real (unscored) lead with its requirements,
 * flagged as a target — so it immediately feeds the Coverage Matrix and pulls its
 * Core/Important gaps into the coach queue, exactly like any flagged role.
 */
export async function flagDoorAsTargetAction(archetypeKey: string): Promise<{ leadId: string } | { error: string }> {
  const owner = await currentOwnerId();
  const a = archetypeByKey(archetypeKey);
  if (!a) return { error: 'Unknown archetype.' };

  // Idempotent: a door already flagged returns its existing lead rather than
  // creating a duplicate target (which would pollute the board, matrix and coach).
  const [existing] = await db
    .select({ id: jobLeads.id })
    .from(jobLeads)
    .where(and(eq(jobLeads.ownerId, owner), eq(jobLeads.source, 'Discover'), eq(jobLeads.title, a.title)))
    .limit(1);
  if (existing) return { leadId: existing.id };

  // Lead + its requirements land together or not at all — never an orphan lead
  // with no must-haves (which would break screening and coverage).
  const leadId = await db.transaction(async (tx) => {
    const [lead] = await tx
      .insert(jobLeads)
      .values({ ownerId: owner, title: a.title, status: 'captured', isTarget: true, source: 'Discover' })
      .returning({ id: jobLeads.id });
    await tx.insert(jobRequirements).values(
      a.requirements.map((r, i) => ({
        ownerId: owner,
        jobLeadId: lead.id,
        leadTitle: a.title,
        requirement: r.requirement,
        rank: r.rank,
        requirementOrder: i + 1,
      }))
    );
    return lead.id;
  });

  await recordActivity(owner, 'target_flagged', { leadId, summary: `Flagged a door as a target: ${a.title}` });
  await recordUxEvent(owner, 'discover', 'flag_target', { leadId, meta: { archetype: a.key } });
  await generatePrompts(owner).catch(() => {});
  revalidatePath('/discover');
  revalidatePath('/roleproof');
  revalidatePath('/profile/coverage');
  return { leadId };
}

/** C2/R4 · Mirror "disagree" + door open/test/verdict-flag/verdict-disagree reaction signals. */
export async function trackDiscoverAction(
  event: 'disagree' | 'open' | 'door_test' | 'door_verdict_flag' | 'door_verdict_disagree',
  archetypeKey?: string
): Promise<void> {
  try {
    const owner = await currentOwnerId();
    await recordUxEvent(owner, 'discover', event, { meta: archetypeKey ? { archetype: archetypeKey } : undefined });
  } catch {
    /* telemetry only */
  }
}
