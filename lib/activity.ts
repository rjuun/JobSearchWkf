/**
 * Activity log → the Statement (Additive Plan · B1). Existing server actions append
 * one line here per meaningful move; the Statement page re-projects the stream into
 * a monthly re-entry ritual. Writes are best-effort — logging a move must never break
 * the move itself. Reads and the recap rollup are pure over the event stream.
 */
import { and, desc, eq, gt, gte } from 'drizzle-orm';
import { db } from './db';
import { activityEvents, profiles } from './db/schema';

export type ActivityKind =
  | 'evidence_kept' //   a C2 tailoring row was Kept
  | 'coach_approved' //  a coached answer was approved into the graph
  | 'target_flagged' //  a role was flagged as a target
  | 'screening' //       a lead was screened (fit produced)
  | 'cv_generated' //    a tailored CV was produced
  | 'story_generated' // a career through-line version was generated (C1)
  | 'applied' //         an application was sent
  | 'outcome'; //        an application outcome was recorded

/** Fire-and-forget: append one activity line. Swallows errors by design. */
export async function recordActivity(
  owner: string,
  kind: ActivityKind,
  opts: { leadId?: string | null; summary?: string; meta?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    await db.insert(activityEvents).values({
      ownerId: owner,
      kind,
      leadId: opts.leadId ?? null,
      summary: opts.summary ?? null,
      meta: opts.meta ?? null,
    });
  } catch {
    /* the activity log must never break the action it records */
  }
}

export type ActivityRow = {
  id: string;
  kind: string;
  leadId: string | null;
  summary: string | null;
  at: Date;
};

/** The owner's activity since `sinceDays` ago (default 30), newest first. */
export async function listActivity(owner: string, sinceDays = 30): Promise<ActivityRow[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: activityEvents.id,
      kind: activityEvents.kind,
      leadId: activityEvents.leadId,
      summary: activityEvents.summary,
      at: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(and(eq(activityEvents.ownerId, owner), gte(activityEvents.createdAt, since)))
    .orderBy(desc(activityEvents.createdAt));
  return rows;
}

export type StatementTotals = {
  evidenceKept: number;
  coachApproved: number;
  targetsFlagged: number;
  screened: number;
  cvsGenerated: number;
  applied: number;
  outcomes: number;
  total: number;
};

/** Pure: roll an event stream up into the Statement's headline counts. */
export function summarizeStatement(rows: { kind: string }[]): StatementTotals {
  const n = (k: string) => rows.filter((r) => r.kind === k).length;
  const evidenceKept = n('evidence_kept');
  const coachApproved = n('coach_approved');
  const targetsFlagged = n('target_flagged');
  const screened = n('screening');
  const cvsGenerated = n('cv_generated');
  const applied = n('applied');
  const outcomes = n('outcome');
  return {
    evidenceKept,
    coachApproved,
    targetsFlagged,
    screened,
    cvsGenerated,
    applied,
    outcomes,
    total: rows.length,
  };
}

// ── R2b · The Statement's re-entry ritual (board #2b/#2e) ─────────────────────
// Nothing brought the user *back* to the Statement. These close that loop: a
// per-owner "last seen" marker, a digest of what accrued since, and a pure headline.

export type StatementDigest = {
  since: Date | null;
  newCount: number;
  totals: StatementTotals;
  latest: ActivityRow[]; // a few headline lines for the banner
};

/** The owner's activity newer than `since`, rolled up. Null `since` ⇒ empty (no prior visit). */
export async function digestSince(owner: string, since: Date | null, limit = 3): Promise<StatementDigest> {
  if (!since) return { since: null, newCount: 0, totals: summarizeStatement([]), latest: [] };
  const rows = await db
    .select({
      id: activityEvents.id,
      kind: activityEvents.kind,
      leadId: activityEvents.leadId,
      summary: activityEvents.summary,
      at: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(and(eq(activityEvents.ownerId, owner), gt(activityEvents.createdAt, since)))
    .orderBy(desc(activityEvents.createdAt));
  return { since, newCount: rows.length, totals: summarizeStatement(rows), latest: rows.slice(0, limit) };
}

/**
 * When this owner last looked at their Statement. Defensive: if the column predates
 * the 0016 migration, degrade to null (the banner simply stays quiet) rather than throw.
 */
export async function getStatementSeenAt(owner: string): Promise<Date | null> {
  try {
    const [p] = await db.select({ seen: profiles.statementSeenAt }).from(profiles).where(eq(profiles.id, owner));
    return p?.seen ?? null;
  } catch {
    return null;
  }
}

/**
 * Is a return digest worth interrupting the board for? A single stray event isn't —
 * the banner only earns its place when several things happened, or a couple of
 * different kinds did (a real session's worth). Keeps R3 dark at cold-start.
 */
export function digestIsSubstantive(d: StatementDigest): boolean {
  const t = d.totals;
  const kinds = [t.evidenceKept, t.coachApproved, t.targetsFlagged, t.screened, t.cvsGenerated, t.applied, t.outcomes].filter(
    (n) => n > 0
  ).length;
  return d.newCount >= 3 || kinds >= 2;
}

/** Mark the Statement seen now. Best-effort — a marker write must never break a page. */
export async function markStatementSeen(owner: string): Promise<void> {
  try {
    await db.update(profiles).set({ statementSeenAt: new Date(), updatedAt: new Date() }).where(eq(profiles.id, owner));
  } catch {
    /* best-effort marker */
  }
}

/**
 * Pure: an honest one-line summary of what accrued — the two or three loudest kinds,
 * in plain language, no vanity padding. "3 pieces of evidence, 2 CVs and 1 application".
 */
export function digestHeadline(totals: StatementTotals): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(totals.evidenceKept, 'piece of evidence kept', 'pieces of evidence kept');
  add(totals.coachApproved, 'coached answer', 'coached answers');
  add(totals.cvsGenerated, 'CV tailored', 'CVs tailored');
  add(totals.targetsFlagged, 'target flagged', 'targets flagged');
  add(totals.screened, 'role screened', 'roles screened');
  add(totals.applied, 'application sent', 'applications sent');
  add(totals.outcomes, 'outcome logged', 'outcomes logged');
  if (parts.length === 0) return 'Nothing new yet.';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  // Cap the line at the three loudest so it never becomes a wall of counts.
  const [a, b, c] = parts;
  const more = parts.length - 3;
  return more > 0 ? `${a}, ${b}, ${c} and ${more} more` : `${a}, ${b} and ${c}`;
}
