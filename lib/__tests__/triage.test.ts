import { describe, it, expect } from 'vitest';
import { computeTriage, triagePriority, isStale, type TriageLead } from '../triage';

const lead = (o: Partial<TriageLead> = {}): TriageLead => ({
  id: Math.random().toString(36).slice(2),
  title: 'Head of FP&A',
  company: 'Acme',
  city: 'Vienna',
  status: 'screened',
  overallFitScore: 7,
  postedDays: 5,
  applicantCount: 20,
  freshnessBand: 'Fresh',
  saturationBand: 'Low',
  flagCount: 0,
  ...o,
});

describe('triagePriority', () => {
  it('rewards fit × freshness × low competition', () => {
    const strong = triagePriority(lead({ overallFitScore: 9, freshnessBand: 'Very fresh', saturationBand: 'Low' }));
    const weak = triagePriority(lead({ overallFitScore: 5, freshnessBand: 'Aging', saturationBand: 'High' }));
    expect(strong).toBeGreaterThan(weak);
  });

  it('penalises flags and never goes below zero', () => {
    const clean = triagePriority(lead({ flagCount: 0 }));
    const flagged = triagePriority(lead({ flagCount: 3 }));
    expect(flagged).toBeLessThan(clean);
    expect(triagePriority(lead({ overallFitScore: 1, freshnessBand: 'Likely dead', saturationBand: 'High', flagCount: 3 }))).toBeGreaterThanOrEqual(0);
  });
});

describe('isStale / auto-hold', () => {
  it('holds by stale band or old posting, not fresh ones', () => {
    expect(isStale(lead({ freshnessBand: 'Likely dead' }))).toBe(true);
    expect(isStale(lead({ freshnessBand: 'Fresh', postedDays: 74 }))).toBe(true);
    expect(isStale(lead({ freshnessBand: 'Fresh', postedDays: 5 }))).toBe(false);
  });
});

describe('computeTriage', () => {
  it('excludes applied/archived/hold and unscored leads', () => {
    const t = computeTriage([
      lead({ status: 'applied' }),
      lead({ status: 'archived' }),
      lead({ overallFitScore: null }),
      lead({ status: 'screened' }),
    ]);
    expect(t.consideredCount).toBe(1);
  });

  it('caps picks at capacity, spills the rest to waiting, ordered by priority', () => {
    const t = computeTriage(
      [
        lead({ overallFitScore: 6 }),
        lead({ overallFitScore: 9 }),
        lead({ overallFitScore: 7.5 }),
      ],
      2
    );
    expect(t.picks).toHaveLength(2);
    expect(t.waiting).toHaveLength(1);
    expect(t.picks[0].overallFitScore).toBe(9); // highest priority first
    expect(t.picks.map((p) => p.priority)).toEqual([...t.picks.map((p) => p.priority)].sort((a, b) => b - a));
  });

  it('routes stale leads to held so nothing rots in the live queue', () => {
    const t = computeTriage([
      lead({ overallFitScore: 8, freshnessBand: 'Fresh', postedDays: 3 }),
      lead({ overallFitScore: 8, freshnessBand: 'Likely dead', postedDays: 90 }),
    ]);
    expect(t.picks).toHaveLength(1);
    expect(t.held).toHaveLength(1);
    expect(t.held[0].ageLabel).toBe('90 d');
  });

  it('defaults capacity to 2 when unset or non-positive', () => {
    const many = [1, 2, 3, 4].map((n) => lead({ overallFitScore: n + 4 }));
    expect(computeTriage(many, null).picks).toHaveLength(2);
    expect(computeTriage(many, 0).picks).toHaveLength(2);
    expect(computeTriage(many, 3).picks).toHaveLength(3);
  });
});
