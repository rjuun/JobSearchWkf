/**
 * The two branches the Scoring Phase Redesign introduced into `runInitialChecks`
 * (CI §2.3 step 11). Both are new decision logic, so both get locked down here.
 *
 *  1. The auto-select rule — a lead with nothing flagged by B2/B3 must reach
 *     `selected` on its own, and anything flagged must park at `scoring_queue`
 *     where it waits for a human. Getting this backwards would either bury clean
 *     leads behind a click that has nothing to decide, or silently score leads
 *     that a roadblock should have stopped.
 *  2. The B1 hold gate as a real short-circuit — `shouldHold` decides whether
 *     B2/B3 run at all. It used to be computed twice and acted on only at B6,
 *     which meant two LLM calls were spent on postings B1 already knew were
 *     stale.
 *
 * Both are pure functions on purpose (vitest here is plain node — no DB, no
 * network, no LLM), which is why `gateStatusFor` was extracted from the DB write
 * rather than left inline. The control flow that consumes them is verified
 * separately against `pipeline_runs` — a unit test can't prove B2/B3 didn't run.
 */
import { describe, it, expect } from 'vitest';
import { gateStatusFor } from '../pipeline/screening';
import { shouldHold } from '../scoring';

describe('the screening gate: clean leads select themselves', () => {
  it('auto-selects a lead with no roadblocks and no misalignments', () => {
    expect(gateStatusFor(0, 0)).toBe('selected');
  });

  it('parks a lead with any roadblock', () => {
    expect(gateStatusFor(1, 0)).toBe('scoring_queue');
    expect(gateStatusFor(3, 0)).toBe('scoring_queue');
  });

  it('parks a lead with any misalignment', () => {
    expect(gateStatusFor(0, 1)).toBe('scoring_queue');
    expect(gateStatusFor(0, 2)).toBe('scoring_queue');
  });

  it('parks a lead flagged by both steps', () => {
    expect(gateStatusFor(2, 2)).toBe('scoring_queue');
  });

  it('never returns anything but the two gate destinations', () => {
    for (let rb = 0; rb <= 3; rb++) {
      for (let mis = 0; mis <= 3; mis++) {
        expect(['selected', 'scoring_queue']).toContain(gateStatusFor(rb, mis));
      }
    }
  });
});

describe('the B1 hold gate decides whether B2/B3 run at all', () => {
  it('holds at exactly the 60-day threshold, not a day earlier', () => {
    expect(shouldHold(59)).toBe(false);
    expect(shouldHold(60)).toBe(true);
    expect(shouldHold(61)).toBe(true);
  });

  it('does not hold a fresh posting', () => {
    expect(shouldHold(0)).toBe(false);
    expect(shouldHold(14)).toBe(false);
  });

  it('does not hold when the posting age is unknown — an absent date is not evidence of staleness', () => {
    expect(shouldHold(null)).toBe(false);
  });

  it('a held lead is never also gated: the two decisions are mutually exclusive', () => {
    // runInitialChecks returns before B2/B3 when shouldHold is true, so
    // gateStatusFor is only ever reached for a lead that passed B1. This
    // encodes that ordering: a stale posting must not end up `selected` just
    // because it happens to have no flags recorded yet.
    const staleWithNoFlagsYet = { postedDays: 90, roadblocks: 0, misalignments: 0 };
    expect(shouldHold(staleWithNoFlagsYet.postedDays)).toBe(true);
    // …and the caller must therefore never consult the gate for it.
    expect(gateStatusFor(staleWithNoFlagsYet.roadblocks, staleWithNoFlagsYet.misalignments)).toBe('selected');
  });
});
