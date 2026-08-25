/**
 * C3 · Select the CV Evidence Set — CI · C3 Selects the CV Evidence Set.
 *
 * The whole point of `lib/pipeline/selection.ts` being pure is that the CHOICE
 * is provable without Postgres or an API key. These are the properties the note
 * argues for, pinned: the `max` is what kills redundancy, the constraints make
 * it a CV rather than a score, the budget is a parameter, and the same inputs
 * give the same set every run (§2.8's last criterion).
 */
import { describe, it, expect } from 'vitest';
import {
  selectEvidence,
  objective,
  coverageOf,
  formatCoverage,
  impact,
  matchQuality,
  requirementWeight,
  positionOf,
  flooredPositions,
  positionCounts,
  DEFAULT_SELECTION_PARAMS,
  POSITION_ORDER,
  type SelectionCandidate,
  type SelectionParams,
} from '../pipeline/selection';
import { matchStrengthToScore } from '../scoring';

const P = (over: Partial<SelectionParams> = {}): SelectionParams => ({ ...DEFAULT_SELECTION_PARAMS, ...over });

function cand(ref: string, slot: string | null, links: [string, string, string][], text = ''): SelectionCandidate {
  return {
    ref,
    cvPosition: slot,
    text,
    links: links.map(([requirementId, rank, matchStrength]) => ({
      requirementId,
      rank,
      matchStrength,
      requirementSkills: [],
    })),
  };
}

const A1 = 'Professional Experience - A1. Outsourcing Framework Project';
const A2 = 'Professional Experience - A2. Governance Transformation Project';
const A3 = 'Professional Experience - A3. BBAG Wind Down Project';
const A0 = 'Professional Experience - A0. Role Overview';
const B1 = 'Professional Experience - B1. Accounting Correction Layer Project';
const B2 = 'Professional Experience - B2. Transfer Pricing';
const B0 = 'Professional Experience - B0. Role Overview';
const C1 = 'Professional Experience - C1. BBSA Merger Project';
const D1 = 'Professional Experience - D1. Servicing Center Project';

describe('the objective (CI §2.3)', () => {
  it('weights Core above Important above Nice-to-Have', () => {
    expect(requirementWeight('Core')).toBe(3);
    expect(requirementWeight('Important')).toBe(2);
    expect(requirementWeight('Nice-to-Have')).toBe(1);
  });

  it('gives an unranked requirement less than Nice-to-Have but more than nothing', () => {
    // It still has owner-approved evidence behind it, so it is not worthless;
    // it queues last, matching `prioritiseSkills`' convention for the same case.
    expect(requirementWeight(null)).toBeGreaterThan(0);
    expect(requirementWeight(null)).toBeLessThan(requirementWeight('Nice-to-Have'));
  });

  it('orders match quality the same way matchStrengthToScore does', () => {
    // The VALUES differ deliberately (§2.3 specifies 0–1; matchStrengthToScore
    // is B6's 0–10 fit score). The ORDER must not: two modules disagreeing
    // about whether Very Strong beats Good is the kind of drift that only
    // surfaces as a strange CV.
    const labels = ['Excellent', 'Very Strong', 'Good', 'Weak', 'No Match'];
    const ours = labels.map((l) => matchQuality(l));
    const theirs = labels.map((l) => matchStrengthToScore(l) as number);
    for (let i = 1; i < labels.length; i++) {
      expect(ours[i - 1]).toBeGreaterThan(ours[i]);
      expect(theirs[i - 1]).toBeGreaterThan(theirs[i]);
    }
  });

  it('treats an unrecognised match strength as Weak, not as Excellent', () => {
    // A legacy row written before C2 stamped the label must not score itself up.
    expect(matchQuality(null)).toBe(matchQuality('Weak'));
    expect(matchQuality('nonsense')).toBe(matchQuality('Weak'));
  });

  it('scores a STAR result carrying its own metric above prose with a figure above prose without one', () => {
    // The top tier is why CI · STAR Results Never Reach the Evidence Graph had
    // to land first: the metric appears nowhere in the prose.
    expect(impact('Consolidated 12 branches — measured: EUR 1.5B assets migrated')).toBe(1);
    expect(impact('Reduced annual IT cost payments by nearly 50%')).toBe(0.5);
    expect(impact('Led the procurement of a EUR 2 million consulting engagement')).toBe(0.5);
    expect(impact('Built the Controlling function from the ground up')).toBe(0);
  });

  it('does not count a bare integer as a measured outcome', () => {
    // "600 tasks" and "10 department heads" are scale, not measurement. If they
    // counted, the term would fire on most of the bank and stop discriminating.
    expect(impact('Created a project schedule of over 600 tasks per branch')).toBe(0);
    expect(impact('with contributions from 10 Heads of Department')).toBe(0);
  });

  it('takes the MAX per requirement, so a second bullet on a covered requirement adds almost nothing', () => {
    // This is the mechanism §2.3 rests on: redundancy stops paying without any
    // explicit anti-duplication rule, which is also what makes V submodular.
    const first = cand('E1', A1, [['q1', 'Core', 'Excellent']]);
    const dupe = cand('E2', A2, [['q1', 'Core', 'Excellent']]);
    const fresh = cand('E3', A2, [['q2', 'Core', 'Excellent']]);
    const base = objective([first]).total;
    expect(objective([first, dupe]).total - base).toBeCloseTo(0, 6);
    expect(objective([first, fresh]).total - base).toBeGreaterThan(2);
  });

  it('lets a stronger link raise a requirement already covered weakly', () => {
    const weak = cand('E1', A1, [['q1', 'Core', 'Good']]);
    const strong = cand('E2', A2, [['q1', 'Core', 'Excellent']]);
    expect(objective([weak, strong]).total).toBeGreaterThan(objective([weak]).total);
    // …but only by the difference, not by a second full helping.
    expect(objective([weak, strong]).coverage).toBeCloseTo(3 * 1.0, 6);
  });
});

describe('the budget (CI §2.6)', () => {
  const pool = Array.from({ length: 20 }, (_, i) =>
    cand(`E${String(i).padStart(2, '0')}`, [A1, B1, C1, D1][i % 4], [[`q${i}`, 'Core', 'Excellent']])
  );

  it('defaults to 14', () => {
    expect(DEFAULT_SELECTION_PARAMS.budget).toBe(14);
  });

  it('is a parameter — the same pool selects a different number when B changes', () => {
    // The whole point of §2.6: re-calibration happens in the format CI by
    // changing this number, without touching the algorithm.
    expect(selectEvidence(pool, P({ budget: 6, perPositionCap: 99 })).selected).toHaveLength(6);
    expect(selectEvidence(pool, P({ budget: 14, perPositionCap: 99 })).selected).toHaveLength(14);
    expect(selectEvidence(pool, P({ budget: 20, perPositionCap: 99 })).selected).toHaveLength(20);
  });

  it('selects fewer than B rather than inventing candidates', () => {
    expect(selectEvidence(pool.slice(0, 3), P({ perPositionCap: 99 })).selected).toHaveLength(3);
  });

  it('numbers the selected items densely from 1', () => {
    const ranks = selectEvidence(pool, P({ budget: 9, perPositionCap: 99 })).selected.map((s) => s.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('the shape constraints (CI §2.4)', () => {
  it('never puts more than the cap under one position', () => {
    // "Cardinality alone will happily put nine bullets on one role and none on
    // the next" — the sentence this constraint exists for.
    const lopsided = Array.from({ length: 12 }, (_, i) => cand(`A${i}`, A1, [[`q${i}`, 'Core', 'Excellent']]));
    const res = selectEvidence(lopsided, P({ budget: 10, perPositionCap: 4 }));
    expect(res.selected).toHaveLength(4);
    expect(res.dropped.some((d) => d.reason === 'position cap')).toBe(true);
  });

  it('counts A1/A2/A3 as one position, not three', () => {
    expect(positionOf(A1)).toBe('A');
    expect(positionOf(A3)).toBe('A');
    expect(positionOf(D1)).toBe('D');
    expect(positionOf(null)).toBeNull();
  });

  it('takes position order from CV_SLOTS rather than from the alphabet', () => {
    expect(POSITION_ORDER).toEqual(['A', 'B', 'C', 'D']);
  });

  it('keeps at least one bullet on each of the most recent roles', () => {
    // Everything valuable sits under A; the floor must still buy B and C a place.
    const pool: SelectionCandidate[] = [
      ...Array.from({ length: 8 }, (_, i) => cand(`A${i}`, A1, [[`q${i}`, 'Core', 'Excellent']])),
      cand('B1x', B1, [['qb', 'Nice-to-Have', 'Weak']]),
      cand('C1x', C1, [['qc', 'Nice-to-Have', 'Weak']]),
    ];
    const res = selectEvidence(pool, P({ budget: 4, perPositionCap: 4 }));
    const counts = positionCounts(pool.filter((c) => res.selected.some((s) => s.ref === c.ref)));
    expect(counts.get('B') ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.get('C') ?? 0).toBeGreaterThanOrEqual(1);
    expect(res.notes.some((n) => n.startsWith('floor:'))).toBe(true);
  });

  it('does not demand a floor from a position with nothing to offer', () => {
    // Requiring it would make the constraint unsatisfiable rather than strict.
    const onlyAB = [cand('A1x', A1, [['q1', 'Core', 'Excellent']]), cand('B1x', B1, [['q2', 'Core', 'Excellent']])];
    expect(flooredPositions(onlyAB)).toEqual(['A', 'B']);
    expect(() => selectEvidence(onlyAB)).not.toThrow();
    expect(selectEvidence(onlyAB).selected).toHaveLength(2);
  });

  it('exempts a slotless ref from the cap instead of blocking it', () => {
    // There is no position for it to crowd.
    const pool = [
      ...Array.from({ length: 4 }, (_, i) => cand(`A${i}`, A1, [[`q${i}`, 'Core', 'Excellent']])),
      cand('X1', null, [['qx', 'Core', 'Excellent']]),
    ];
    const res = selectEvidence(pool, P({ budget: 6, perPositionCap: 4 }));
    expect(res.selected.map((s) => s.ref)).toContain('X1');
  });
});

describe('the owner still decides (CI §2.2, §2.7 item 5)', () => {
  const pool = [
    cand('STRONG', A1, [['q1', 'Core', 'Excellent'], ['q2', 'Core', 'Excellent']]),
    cand('MID', B1, [['q3', 'Core', 'Excellent']]),
    cand('WEAK', C1, [['q4', 'Nice-to-Have', 'Weak']]),
  ];

  it('never selects an excluded row', () => {
    const res = selectEvidence(
      pool.map((c) => (c.ref === 'STRONG' ? { ...c, pin: 'exclude' as const } : c)),
      P({ budget: 3 })
    );
    expect(res.selected.map((s) => s.ref)).not.toContain('STRONG');
    expect(res.dropped.find((d) => d.ref === 'STRONG')?.reason).toBe('excluded');
  });

  it('enters a pinned row before the algorithm runs, and it consumes budget', () => {
    const res = selectEvidence(
      pool.map((c) => (c.ref === 'WEAK' ? { ...c, pin: 'pin' as const } : c)),
      P({ budget: 1 })
    );
    expect(res.selected.map((s) => s.ref)).toEqual(['WEAK']);
    expect(res.selected[0].pinned).toBe(true);
  });

  it('lets a pin override the per-position cap, because the cap exists to police the algorithm', () => {
    const crowded: SelectionCandidate[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ ...cand(`A${i}`, A1, [[`q${i}`, 'Core', 'Excellent']]), pin: 'pin' as const })),
    ];
    const res = selectEvidence(crowded, P({ budget: 5, perPositionCap: 4 }));
    expect(res.selected).toHaveLength(5);
  });

  it('never swaps a pinned row back out', () => {
    const res = selectEvidence(
      pool.map((c) => (c.ref === 'WEAK' ? { ...c, pin: 'pin' as const } : c)),
      P({ budget: 2 })
    );
    expect(res.selected.map((s) => s.ref)).toContain('WEAK');
  });
});

describe('reproducibility (CI §2.8)', () => {
  const pool = [
    cand('G1', A3, [['q1', 'Core', 'Excellent'], ['q2', 'Important', 'Excellent']]),
    cand('C5', B2, [['q3', 'Core', 'Good'], ['q4', 'Important', 'Very Strong']]),
    cand('S1', C1, [['q5', 'Core', 'Excellent']]),
    cand('P1', D1, [['q6', 'Core', 'Good']]),
    cand('L2', A0, [['q1', 'Core', 'Good']]),
    cand('B-R1', B0, [['q3', 'Core', 'Very Strong']]),
  ];

  it('gives the same set and the same order on every run', () => {
    const a = selectEvidence(pool, P({ budget: 4 }));
    const b = selectEvidence(pool, P({ budget: 4 }));
    expect(b.selected).toEqual(a.selected);
  });

  it('gives the same set regardless of the order the candidates arrive in', () => {
    const forwards = selectEvidence(pool, P({ budget: 4 })).selected.map((s) => s.ref).sort();
    const backwards = selectEvidence([...pool].reverse(), P({ budget: 4 })).selected.map((s) => s.ref).sort();
    expect(backwards).toEqual(forwards);
  });

  it('breaks a tie by standalone value, not by ref order', () => {
    // Measured on all three real leads: V goes flat after ~6 picks, so the
    // tie-break decides the back half of every CV. Left implicit it would be
    // alphabetical, which is not a reason to put a bullet on a CV.
    const tied = [
      // Both add nothing new — q1 is already covered at Excellent by SEED.
      cand('AAA', B1, [['q1', 'Core', 'Weak']]),
      cand('ZZZ', B1, [['q1', 'Core', 'Excellent'], ['q1b', 'Core', 'Excellent']]),
      cand('SEED', A1, [['q1', 'Core', 'Excellent'], ['q1b', 'Core', 'Excellent']]),
    ];
    const res = selectEvidence(tied, P({ budget: 2, floorPositions: 0 }));
    expect(res.selected.map((s) => s.ref)).toEqual(['SEED', 'ZZZ']);
  });
});

describe('what the step report has to be able to say (CI §2.7 item 4)', () => {
  const pool = [
    cand('G1', A3, [['q1', 'Core', 'Excellent'], ['q2', 'Important', 'Excellent']]),
    cand('C5', B2, [['q3', 'Core', 'Good']]),
    cand('S1', C1, [['q4', 'Core', 'Excellent']]),
    cand('SPARE', A1, [['q1', 'Core', 'Good']]),
  ];
  const universe = [
    { id: 'q1', rank: 'Core' },
    { id: 'q2', rank: 'Important' },
    { id: 'q3', rank: 'Core' },
    { id: 'q4', rank: 'Core' },
    { id: 'q5', rank: 'Nice-to-Have' },
  ];

  it('reports coverage against every extracted requirement, including ones nothing covers', () => {
    // Measuring against the evidence instead would hide an uncovered
    // requirement by construction — which is the one fact worth seeing.
    const res = selectEvidence(pool, P({ budget: 3 }));
    const chosen = pool.filter((c) => res.selected.some((s) => s.ref === c.ref));
    expect(formatCoverage(coverageOf(chosen, universe))).toBe('Core 3/3 · Important 1/1 · Nice-to-Have 0/1');
  });

  it('says what each item newly covered and what the displaced items would have added', () => {
    const res = selectEvidence(pool, P({ budget: 3 }));
    expect(res.selected[0].newlyCovered.length).toBeGreaterThan(0);
    const spare = res.dropped.find((d) => d.ref === 'SPARE');
    expect(spare).toBeDefined();
    expect(spare!.reason).toBe('outranked');
    expect(spare!.gain).toBeCloseTo(0, 6);
  });

  it('records the parameters it ran under, so the budget stays judged rather than inherited', () => {
    const res = selectEvidence(pool, P({ budget: 3 }));
    expect(res.params.budget).toBe(3);
    expect(res.params).toMatchObject({ perPositionCap: 4, floorPositions: 3 });
  });
});

describe('degenerate inputs', () => {
  it('selects nothing from nothing', () => {
    const res = selectEvidence([]);
    expect(res.selected).toEqual([]);
    expect(res.objective.total).toBe(0);
  });

  it('handles a budget of zero without throwing', () => {
    expect(selectEvidence([cand('E1', A1, [['q1', 'Core', 'Excellent']])], P({ budget: 0 })).selected).toEqual([]);
  });

  it('still selects a ref that carries no requirement link at all', () => {
    // It contributes no coverage, so it can only ever be surplus — but a Keep
    // row with a null requirement_id is real data and must not crash the step.
    const res = selectEvidence([cand('ORPHAN', A1, [])], P({ budget: 2 }));
    expect(res.selected.map((s) => s.ref)).toEqual(['ORPHAN']);
  });
});
