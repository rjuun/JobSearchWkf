/**
 * Single source of truth for every status / score / rank / recommendation colour
 * in the app. Previously these maps were duplicated across components/ui.tsx and
 * the old dashboard; now badges, funnel bars and the journey rail all read from here.
 *
 * A "tone" is a soft, ringed badge palette. Each domain enum maps to a tone plus a
 * solid `bar` colour (for charts) and a human label.
 */
import { normalizeRecommendation } from './db/types';

// The proof palette — one accent (proof green), one caution (amber), one negative (rose),
// and neutral for everything in-between. Journey stage is conveyed by position + the rail,
// never by hue (M6). `green` is the proof accent; the old status rainbow is retired.
export type Tone = 'neutral' | 'green' | 'amber' | 'rose';

/** Soft badge classes per tone (bg + text + inset ring). */
export const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  green: 'bg-proof-soft text-proof-deep ring-proof-ring',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
};

/** Solid dot per tone (for inline status dots). */
export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  green: 'bg-proof',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
};

// ── Lead status ──────────────────────────────────────────────────────────────

export type LeadStatus =
  | 'captured'
  | 'screening'
  | 'hold'
  | 'screened'
  | 'promoted'
  | 'tailoring'
  | 'ready'
  | 'applied'
  | 'archived';

/** Which macro-stage of the A→B→C→D journey a status belongs to. */
export type JourneyStage = 'capture' | 'screen' | 'tailor' | 'applied' | 'archived';

export const STATUS_META: Record<
  LeadStatus,
  { label: string; tone: Tone; bar: string; stage: JourneyStage }
> = {
  // Hue carries only meaning, not journey position: neutral = in progress, amber = held,
  // green = a positive endpoint (CV ready / applied). Stage is shown by the rail + order.
  captured: { label: 'Captured', tone: 'neutral', bar: 'bg-slate-300', stage: 'capture' },
  screening: { label: 'Screening', tone: 'neutral', bar: 'bg-slate-400', stage: 'screen' },
  hold: { label: 'On hold', tone: 'amber', bar: 'bg-amber-400', stage: 'screen' },
  screened: { label: 'Screened', tone: 'neutral', bar: 'bg-slate-400', stage: 'screen' },
  promoted: { label: 'Promoted', tone: 'neutral', bar: 'bg-slate-500', stage: 'tailor' },
  tailoring: { label: 'Tailoring', tone: 'neutral', bar: 'bg-slate-500', stage: 'tailor' },
  ready: { label: 'Ready', tone: 'green', bar: 'bg-proof', stage: 'tailor' },
  applied: { label: 'Applied', tone: 'green', bar: 'bg-proof', stage: 'applied' },
  archived: { label: 'Archived', tone: 'neutral', bar: 'bg-slate-200', stage: 'archived' },
};

/** Canonical display order for funnels / grouping. */
export const STATUS_ORDER: LeadStatus[] = [
  'captured',
  'screening',
  'hold',
  'screened',
  'promoted',
  'tailoring',
  'ready',
  'applied',
  'archived',
];

export function statusMeta(status: string) {
  return STATUS_META[status as LeadStatus] ?? STATUS_META.captured;
}

// ── B6 recommendation tiers ──────────────────────────────────────────────────

export const RECOMMENDATION_META: Record<string, { tone: Tone; bar: string }> = {
  Proceed: { tone: 'green', bar: 'bg-proof' },
  Borderline: { tone: 'amber', bar: 'bg-amber-400' },
  Hold: { tone: 'neutral', bar: 'bg-slate-400' },
  'Not recommended': { tone: 'rose', bar: 'bg-rose-500' },
  Unscored: { tone: 'neutral', bar: 'bg-slate-200' },
};

export function recommendationMeta(rec: string | null) {
  const key = normalizeRecommendation(rec) ?? 'Unscored';
  return RECOMMENDATION_META[key] ?? RECOMMENDATION_META.Unscored;
}

// ── Fit score → tone (matches the B6 Proceed/Caution thresholds) ──────────────

/** Solid colour for a 0–10 fit score, mirroring the recommendation tiers. */
export function scoreSolid(score: number | null): string {
  if (score == null) return 'bg-slate-200';
  return score >= 7 ? 'bg-proof' : score >= 5.5 ? 'bg-amber-500' : 'bg-rose-500';
}

/** Tone for a 0–10 fit score (soft badge / text contexts). */
export function scoreTone(score: number | null): Tone {
  if (score == null) return 'neutral';
  return score >= 7 ? 'green' : score >= 5.5 ? 'amber' : 'rose';
}

// ── Requirement rank ─────────────────────────────────────────────────────────

export function rankTone(rank: string | null): Tone {
  switch (rank) {
    case 'Core':
      return 'rose';
    case 'Important':
      return 'amber';
    default:
      return 'neutral';
  }
}
