'use server';

/**
 * R6 · The Transition Ledger — the read-only projection over three existing streams
 * (graph_strength_snapshots · activity_events · story_versions). No new capture; the
 * pure buildLedger composes them into a "here's what these months built" timeline.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { graphStrengthSnapshots, activityEvents, storyVersions } from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';
import { buildLedger, LEDGER_MIN_EVENTS, type Ledger } from '@/lib/ledger';

export async function loadLedger(): Promise<Ledger> {
  const owner = await currentOwnerId();
  const [snaps, activity, stories] = await Promise.all([
    db
      .select({ score: graphStrengthSnapshots.score, at: graphStrengthSnapshots.createdAt })
      .from(graphStrengthSnapshots)
      .where(eq(graphStrengthSnapshots.ownerId, owner)),
    db
      .select({ kind: activityEvents.kind, at: activityEvents.createdAt })
      .from(activityEvents)
      .where(eq(activityEvents.ownerId, owner)),
    db.select({ at: storyVersions.createdAt }).from(storyVersions).where(eq(storyVersions.ownerId, owner)),
  ]);
  return buildLedger(snaps, activity, stories, new Date());
}

/**
 * R6 self-gate — a cheap count of the three streams, so the Statement page can decide
 * whether to surface the Ledger tab without building the whole projection.
 */
export async function hasLedgerSubstance(): Promise<boolean> {
  const owner = await currentOwnerId();
  const n = (t: typeof activityEvents | typeof graphStrengthSnapshots | typeof storyVersions) =>
    db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.ownerId, owner));
  const [a, s, st] = await Promise.all([n(activityEvents), n(graphStrengthSnapshots), n(storyVersions)]);
  return (a[0].n + s[0].n + st[0].n) >= LEDGER_MIN_EVENTS;
}
