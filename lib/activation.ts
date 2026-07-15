/**
 * M5 · Activation instrumentation. The two numbers that answer "are new users getting to
 * value?": time-to-first-CV and decisions-before-win, measured from the paste event.
 * Recording is best-effort (never block the user flow); metrics are pure over the events.
 */
import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { activationEvents } from './db/schema';

export type ActivationKind = 'paste' | 'verdict' | 'keep' | 'coach_approval' | 'cv_generated' | 'warmup';

// What counts as a "decision" the user made on the way to their first CV: a C2 tailoring
// Keep OR a coach approval. Both are the human accepting a piece of evidence — the metric
// would understate a coach-heavy path if it counted only C2 Keeps.
const DECISION_KINDS = new Set(['keep', 'coach_approval']);

/** Fire-and-forget: log one funnel event. Swallows errors so it can wrap any action. */
export async function recordActivation(
  owner: string,
  kind: ActivationKind,
  opts: { leadId?: string; meta?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    await db.insert(activationEvents).values({ ownerId: owner, kind, leadId: opts.leadId ?? null, meta: opts.meta ?? null });
  } catch {
    /* instrumentation must never break the flow */
  }
}

export type ActivationMetrics = {
  started: boolean; //           has the user pasted at least once
  firstCv: boolean; //           has a CV been generated
  timeToFirstCvMs: number | null; // paste → first CV
  decisionsBeforeWin: number | null; // Keeps between the first paste and the first CV
  totalKeeps: number;
};

/** Pure: derive the metrics from a time-ordered event stream (unit-tested). */
export function computeActivation(events: { kind: string; at: Date }[]): ActivationMetrics {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const firstOf = (k: string) => sorted.find((e) => e.kind === k)?.at ?? null;
  const start = firstOf('paste') ?? firstOf('warmup');
  const cv = firstOf('cv_generated');
  const totalKeeps = sorted.filter((e) => e.kind === 'keep').length;

  const timeToFirstCvMs = start && cv ? Math.max(0, cv.getTime() - start.getTime()) : null;
  const decisionsBeforeWin =
    start && cv ? sorted.filter((e) => DECISION_KINDS.has(e.kind) && e.at >= start && e.at <= cv).length : null;

  return { started: !!start, firstCv: !!cv, timeToFirstCvMs, decisionsBeforeWin, totalKeeps };
}

/** Compute the activation metrics from an owner's event stream. */
export async function activationMetrics(owner: string): Promise<ActivationMetrics> {
  const events = await db
    .select({ kind: activationEvents.kind, at: activationEvents.createdAt })
    .from(activationEvents)
    .where(eq(activationEvents.ownerId, owner))
    .orderBy(asc(activationEvents.createdAt));
  return computeActivation(events);
}

/** Human-friendly duration for the dashboard (e.g. "4m 12s", "48s"). */
export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
