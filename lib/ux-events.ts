/**
 * Reaction instrumentation (Additive Plan · Wave A). Every additive surface bolts
 * on beside the shipped app and emits 2–3 of these events — this log is how we
 * later answer each item's "fold question" (does the strip/brief/stop-card earn a
 * permanent place, or retire?) from behaviour rather than opinion.
 *
 * Recording is strictly best-effort: telemetry must never break or slow a user
 * flow, so every write swallows its own errors. Reads are pure aggregates.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { uxEvents } from './db/schema';

/** The additive surfaces we instrument. Grows as later waves ship. */
export type UxSurface =
  | 'interview_brief' // A1
  | 'this_week' //       A3
  | 'weekly_triage' //   R5 · the full weekly triage
  | 'coach_session' //   A2
  | 'statement' //       B1
  | 'returns' //         B2
  | 'coverage_matrix' // B3
  | 'sourcing_compass' // B4
  | 'story' //           C1
  | 'discover' //        C2
  | 'proof_link' //      C4
  | 'excavation' //      R2 · surfaced rediscovery invitations
  | 'ledger' //          R6 · the Transition Ledger
  | 'graph_page'; //     R7 · the assembled Career-Graph page (matrix vs meter face)
export type UxEvent =
  | 'open' //             a panel/brief/page was opened or expanded
  | 'print' //            the interview brief was sent to print
  | 'expand_req' //       a requirement was expanded in the full interview brief (R1)
  | 'pick_open' //        a "This week" / triage pick was opened
  | 'pick_tailor' //      a triage pick's "tailor" CTA was taken (R5)
  | 'table_open' //       a lead was opened from the raw board table instead (R5)
  | 'session_complete' // a 3-prompt coach session reached its stop card
  | 'keep_going' //       the user chose to extend past the designed stop
  | 'outcome_logged' //   an application outcome was recorded (Returns)
  | 'gap_click' //        a Coverage Matrix gap cell → coach was clicked
  | 'generate' //         a story version was generated (C1)
  | 'copy' //             a story copy-out (cover letter / LinkedIn) was used (C1)
  | 'disagree' //         a Mirror card was dismissed as not-me (C2)
  | 'flag_target' //      an Unexpected Door was flagged as a target (C2)
  | 'create' //           a Proof Link was created (C4)
  | 'visit' //            a Proof Link was visited by a third party (C4)
  | 'shown' //            an excavation invitation was displayed (R2)
  | 'accepted' //         an excavation invitation was taken up (R2)
  | 'snoozed' //          an excavation invitation was deferred with "not now" (R2)
  | 'banner_shown' //     the Statement re-entry banner was displayed (R3)
  | 'banner_open' //      the Statement re-entry banner was clicked through (R3)
  | 'email_open' //       a Statement digest email was opened (R3, when email ships)
  | 'door_test' //        an Unexpected Door's verdict was opened (R4)
  | 'door_verdict_flag' //a door was flagged as a target *after* testing it (R4)
  | 'door_verdict_disagree' // a tested door's verdict was rejected (R4 — distinct from Mirror disagree)
  | 'mobile_open'; //     a Proof Link was opened on a phone-sized screen (R7 · 3b)

/** Fire-and-forget: append one reaction event. Swallows errors by design. */
export async function recordUxEvent(
  owner: string,
  surface: UxSurface,
  event: UxEvent,
  opts: { leadId?: string | null; meta?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    await db.insert(uxEvents).values({
      ownerId: owner,
      surface,
      event,
      leadId: opts.leadId ?? null,
      meta: opts.meta ?? null,
    });
  } catch {
    /* instrumentation must never break the flow */
  }
}

export type UxTally = { surface: string; event: string; n: number };

/** Per-(surface,event) counts for the owner — the raw material for a fold call. */
export async function uxTallies(owner: string): Promise<UxTally[]> {
  return db
    .select({ surface: uxEvents.surface, event: uxEvents.event, n: sql<number>`count(*)::int` })
    .from(uxEvents)
    .where(eq(uxEvents.ownerId, owner))
    .groupBy(uxEvents.surface, uxEvents.event)
    .orderBy(desc(sql`count(*)`));
}
