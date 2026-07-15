/**
 * Deterministic scoring & gates. THE LLM NEVER COMPUTES THESE — it emits
 * per-dimension judgments; this module does all arithmetic so the Role Fit
 * Score (B6) is reproducible. Mirrors Process/B6 + B1 specs.
 */
import { RANK_WEIGHT, type MatchStrength, type Recommendation } from './db/types';

export const B6_WEIGHTS = {
  relevance: 0.35,
  seniority: 0.2,
  impact: 0.2,
  reqAlignment: 0.15,
  ats: 0.1,
} as const;

export const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));

export type B6Dimensions = {
  relevance: number;
  seniority: number;
  impact: number;
  reqAlignment: number;
  ats: number;
};

/** Weighted average of per-requirement scores; Core 3 / Important 2 / Nice 1. */
export function requirementAlignment(reqs: Array<{ score: number; rank: string | null }>): number {
  if (reqs.length === 0) return 0;
  let weighted = 0;
  let weight = 0;
  for (const r of reqs) {
    const w = RANK_WEIGHT[r.rank ?? ''] ?? 1;
    weighted += clamp(r.score) * w;
    weight += w;
  }
  return weight === 0 ? 0 : round1(weighted / weight);
}

/** Overall Role Fit Score = 0.35·rel + 0.20·sen + 0.20·imp + 0.15·reqAlign + 0.10·ats. */
export function overallFit(d: B6Dimensions): number {
  return round1(
    B6_WEIGHTS.relevance * clamp(d.relevance) +
      B6_WEIGHTS.seniority * clamp(d.seniority) +
      B6_WEIGHTS.impact * clamp(d.impact) +
      B6_WEIGHTS.reqAlignment * clamp(d.reqAlignment) +
      B6_WEIGHTS.ats * clamp(d.ats)
  );
}

export function recommendationFor(overall: number): Recommendation {
  if (overall >= 7) return 'Proceed';
  if (overall >= 5.5) return 'Borderline';
  if (overall >= 4) return 'Hold';
  return 'Not recommended';
}

export function matchStrengthForScore(score: number): MatchStrength {
  if (score >= 9) return 'Excellent';
  if (score >= 7) return 'Very Strong';
  if (score >= 5) return 'Good';
  if (score >= 2) return 'Weak';
  return 'No Match';
}

/** Inverse of matchStrengthForScore — a representative score for a match-strength band. */
export function matchStrengthToScore(ms: string | null): number | null {
  switch (ms) {
    case 'Excellent':
      return 9;
    case 'Very Strong':
      return 7.5;
    case 'Good':
      return 5.5;
    case 'Weak':
      return 3;
    case 'No Match':
      return 1;
    default:
      return null;
  }
}

// ── B1 gate & bands ─────────────────────────────────────────────────────────
export function freshnessBand(days: number | null): string {
  if (days == null) return 'Unknown';
  if (days <= 7) return 'Very fresh';
  if (days <= 21) return 'Fresh';
  if (days <= 60) return 'Aging';
  if (days <= 120) return 'Stale';
  return 'Likely dead';
}

export function saturationBand(applicants: number | null): string {
  if (applicants == null) return 'Unknown';
  if (applicants < 30) return 'Low';
  if (applicants < 100) return 'Moderate';
  return 'High';
}

/** B1 gate: hold leads that are 60+ days old until verified active. */
export function shouldHold(days: number | null): boolean {
  return days != null && days >= 60;
}
