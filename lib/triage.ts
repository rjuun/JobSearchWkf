/**
 * R5 · The Weekly Triage — the full #6a. The A3 "This week" strip picked the top two
 * leads; the board's #6a judges the *whole* queue: capacity-trimmed, with visible rot
 * and auto-hold, so nothing decays silently.
 *
 * Pure computation over data B1 already captured (fit, freshness, saturation, flags) —
 * the same signals the strip uses, composed into one honest priority. No LLM, no new
 * writes: auto-hold is a derived band, not a destructive status change. Unit-tested.
 */

/** Freshness/saturation → multiplier. Shared with the A3 strip so the maths never forks. */
export const FRESH_FACTOR: Record<string, number> = {
  'Very fresh': 1,
  Fresh: 0.85,
  Aging: 0.5,
  Stale: 0.2,
  'Likely dead': 0.05,
};
export const SAT_FACTOR: Record<string, number> = { Low: 1, Moderate: 0.7, High: 0.4 };

/** Freshness bands that mean "verify it's still open" — pulled out of the live queue. */
const STALE_BANDS = new Set(['Stale', 'Likely dead']);
/** Age past which a posting is auto-held regardless of band. */
const STALE_DAYS = 60;
/** Statuses that are no longer "waiting to act" — excluded from triage entirely. */
const DONE_STATUSES = new Set(['applied', 'archived', 'hold']);
const DEFAULT_CAPACITY = 2;

export type TriageLead = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  status: string;
  overallFitScore: number | null;
  postedDays: number | null;
  applicantCount: number | null;
  freshnessBand: string | null;
  saturationBand: string | null;
  flagCount: number; // roadblocks + misalignments
};

export type TriageItem = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  status: string;
  overallFitScore: number | null;
  postedDays: number | null;
  freshnessBand: string | null;
  flagCount: number;
  priority: number; //  fit × freshness × competition − flags, clamped ≥ 0
  reasons: string[];
  ageLabel: string | null; // "74 d"
};

export type Triage = {
  picks: TriageItem[]; //   the top `capacity` — act on these this week
  waiting: TriageItem[]; // the rest of the judged queue
  held: TriageItem[]; //    auto-held stale leads (verify before acting)
  capacity: number;
  consideredCount: number; // live + held
};

/** priority = fit × freshness × competition − flags (all normalised, clamped to ≥ 0). */
export function triagePriority(l: TriageLead): number {
  const fit = l.overallFitScore ?? 0;
  const fresh = FRESH_FACTOR[l.freshnessBand ?? ''] ?? 0.6;
  const sat = SAT_FACTOR[l.saturationBand ?? ''] ?? 0.7;
  const flagPenalty = Math.min(l.flagCount, 3) * 0.08;
  return Math.max(0, (fit / 10) * fresh * sat - flagPenalty);
}

/** Short, honest reasons a lead earned its rank — only claims the bands support. */
export function triageReasons(fit: number, fresh: string | null, sat: string | null, flags: number): string[] {
  const out: string[] = [];
  if (fit >= 7) out.push('Strong fit');
  else if (fit >= 5.5) out.push('Solid fit');
  if (fresh === 'Very fresh' || fresh === 'Fresh') out.push('Fresh posting');
  if (sat === 'Low') out.push('Low competition');
  else if (sat === 'Moderate') out.push('Moderate competition');
  if (flags > 0) out.push(`${flags} watch-out${flags === 1 ? '' : 's'}`);
  return out;
}

/** A stale lead is one whose posting is old enough that it should be re-verified first. */
export function isStale(l: TriageLead): boolean {
  if (STALE_BANDS.has(l.freshnessBand ?? '')) return true;
  return l.postedDays != null && l.postedDays >= STALE_DAYS;
}

function toItem(l: TriageLead): TriageItem {
  return {
    id: l.id,
    title: l.title,
    company: l.company,
    city: l.city,
    status: l.status,
    overallFitScore: l.overallFitScore,
    postedDays: l.postedDays,
    freshnessBand: l.freshnessBand,
    flagCount: l.flagCount,
    priority: triagePriority(l),
    reasons: triageReasons(l.overallFitScore ?? 0, l.freshnessBand, l.saturationBand, l.flagCount),
    ageLabel: l.postedDays != null ? `${l.postedDays} d` : null,
  };
}

/**
 * Judge the whole queue. Scored, still-actionable leads split into a live queue
 * (priority-ordered) and an auto-held set (stale — verify first). The live queue's
 * head, capped at `capacity`, is "this week"; the tail is "waiting".
 */
export function computeTriage(leads: TriageLead[], capacityInput?: number | null): Triage {
  const capacity = capacityInput && capacityInput > 0 ? Math.floor(capacityInput) : DEFAULT_CAPACITY;
  const active = leads.filter((l) => l.overallFitScore != null && !DONE_STATUSES.has(l.status));

  const live: TriageItem[] = [];
  const held: TriageItem[] = [];
  for (const l of active) (isStale(l) ? held : live).push(toItem(l));

  live.sort((a, b) => b.priority - a.priority);
  held.sort((a, b) => (b.postedDays ?? 0) - (a.postedDays ?? 0));

  return {
    picks: live.slice(0, capacity),
    waiting: live.slice(capacity),
    held,
    capacity,
    consideredCount: live.length + held.length,
  };
}
