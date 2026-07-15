/**
 * The two non-negotiables, locked behind tests (redesign_2 kickoff §"Non-negotiables"):
 *
 *  1. Truthfulness — we never invent a metric. A metric-free answer must yield a
 *     blank metric, not a fabricated number.
 *  2. The LLM judges; deterministic code computes the score. `overallFit` and
 *     `recommendationFor` must be reproducible pure functions of the dimensions —
 *     the model never emits the final number.
 *
 * These are pure functions, so the test needs no DB, no network, no LLM.
 */
import { describe, it, expect } from 'vitest';
import { extractMetric } from '../coaching';
import { overallFit, recommendationFor, B6_WEIGHTS, type B6Dimensions } from '../scoring';

describe('truthfulness: never invent a metric', () => {
  it('returns null when the answer contains no number', () => {
    expect(extractMetric('I led the team through a restructuring')).toBeNull();
    expect(extractMetric('Owned the relationship with the regulator')).toBeNull();
    expect(extractMetric('')).toBeNull();
  });

  it('extracts a number the user actually supplied (never fabricates one)', () => {
    expect(extractMetric('cut the month-end close from 20 days to 5')).toBe('20 days');
    expect(extractMetric('reduced cost by 22%')).toBe('22%');
    expect(extractMetric('owned a €210M budget')).toMatch(/210/);
  });
});

describe('the LLM judges; code computes the score', () => {
  const dims: B6Dimensions = { relevance: 8, seniority: 9, impact: 7, reqAlignment: 6, ats: 5 };

  it('overallFit is the exact deterministic B6 weighted sum, not a model output', () => {
    const expected =
      B6_WEIGHTS.relevance * 8 +
      B6_WEIGHTS.seniority * 9 +
      B6_WEIGHTS.impact * 7 +
      B6_WEIGHTS.reqAlignment * 6 +
      B6_WEIGHTS.ats * 5; // 2.8 + 1.8 + 1.4 + 0.9 + 0.5 = 7.4
    expect(overallFit(dims)).toBe(Math.round(expected * 10) / 10);
    expect(overallFit(dims)).toBe(7.4);
  });

  it('is reproducible — same dimensions in, same score out, every time', () => {
    expect(overallFit(dims)).toBe(overallFit({ ...dims }));
  });

  it('clamps out-of-range dimensions instead of trusting the input blindly', () => {
    // A rogue 99 (e.g. a bad model judgment) cannot inflate the score past the cap.
    expect(overallFit({ ...dims, relevance: 99 })).toBe(overallFit({ ...dims, relevance: 10 }));
  });

  it('recommendationFor maps the score across the canonical lexicon thresholds', () => {
    expect(recommendationFor(7.3)).toBe('Proceed');
    expect(recommendationFor(7)).toBe('Proceed');
    expect(recommendationFor(6)).toBe('Borderline');
    expect(recommendationFor(4.5)).toBe('Hold');
    expect(recommendationFor(2)).toBe('Not recommended');
  });
});
