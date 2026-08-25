import { describe, it, expect } from 'vitest';
import { selectionFromRun, latestSelection } from '../selection-view';

/** A C3 step output in the shape `recordStep` actually stores. */
function output(
  selected: { rank: number; ref: string; gain: number }[],
  displaced: { ref: string; wouldAdd: number; reason?: string }[] = [],
  budget = 14
) {
  return { budget, selectedCount: selected.length, candidates: selected.length + displaced.length, selected, displaced };
}

describe('the Map reading of C3 (CI · C3 §2b.4)', () => {
  it('has nothing to show before the map has been approved', () => {
    expect(selectionFromRun(null)).toBeNull();
    expect(selectionFromRun({})).toBeNull();
    expect(selectionFromRun(output([]))).toBeNull();
  });

  it('carries the selected set with its ranks', () => {
    const s = selectionFromRun(
      output([
        { rank: 1, ref: '2-1', gain: 9 },
        { rank: 2, ref: '3-4', gain: 4 },
      ])
    );
    expect(s?.selectedCount).toBe(2);
    expect(s?.byRef['2-1']).toMatchObject({ rank: 1, gain: 9, selected: true, saturated: false, reason: null });
    expect(s?.byRef['3-4'].rank).toBe(2);
  });

  it('ranks the held-back evidence too, from budget + 1, by the gain it would have added', () => {
    // The owner asked for exactly this: the near-misses are 15, 16, 17… so they
    // read as near-misses rather than as an undifferentiated leftover pile.
    const s = selectionFromRun(
      output(
        [{ rank: 1, ref: '2-1', gain: 9 }],
        [
          { ref: '5-2', wouldAdd: 0.4, reason: 'outranked' },
          { ref: '6-1', wouldAdd: 0.1, reason: 'position cap' },
          { ref: '7-3', wouldAdd: 0, reason: 'excluded' },
        ]
      )
    );
    expect(s?.byRef['5-2']).toMatchObject({ rank: 15, selected: false, reason: 'outranked' });
    expect(s?.byRef['6-1']).toMatchObject({ rank: 16, reason: 'position cap' });
    expect(s?.byRef['7-3']).toMatchObject({ rank: 17, reason: 'excluded' });
    expect(s?.heldBackCount).toBe(3);
    expect(s?.candidateCount).toBe(4);
  });

  it('reports what competed, not what the run happened to record', () => {
    // C3 runs written before this shipped stored only the ten strongest of the
    // held-back items, and their leads are frozen — so counting the rows present
    // would understate the pool the budget was chosen from.
    const s = selectionFromRun({
      budget: 14,
      candidates: 32,
      selected: [{ rank: 1, ref: 'a', gain: 9 }],
      displaced: [{ ref: 'b', wouldAdd: 0.2 }],
    });
    expect(s?.candidateCount).toBe(32);
    expect(s?.heldBackCount).toBe(1);
  });

  it('does not invent a rank for evidence C3 never saw', () => {
    // Education and Language refs never enter the budget, so they appear in
    // neither list — and must not be numbered as though they lost a contest.
    const s = selectionFromRun(output([{ rank: 1, ref: '2-1', gain: 9 }]));
    expect(s?.byRef['EDU-1']).toBeUndefined();
  });

  it('marks saturation where the objective stops discriminating', () => {
    const s = selectionFromRun(
      output([
        { rank: 1, ref: 'a', gain: 9 },
        { rank: 2, ref: 'b', gain: 3 },
        { rank: 3, ref: 'c', gain: 0 },
        { rank: 4, ref: 'd', gain: 0 },
      ])
    );
    expect(s?.saturationRank).toBe(3);
    expect(s?.saturatedCount).toBe(2);
  });

  it('draws no saturation line when every pick paid for itself', () => {
    const s = selectionFromRun(
      output([
        { rank: 1, ref: 'a', gain: 9 },
        { rank: 2, ref: 'b', gain: 3 },
      ])
    );
    expect(s?.saturationRank).toBeNull();
    expect(s?.saturatedCount).toBe(0);
  });

  it('marks saturation per card, because rank order is not gain order', () => {
    // Measured on the Allianz lead: the swap pass appends its result at the END
    // of the order regardless of what it added, so rank 3 here carries a real
    // gain while ranks 1–2 do not. The line marks where the zeroes start; which
    // cards are dashed is decided card by card, so the swap-in keeps its outline.
    const s = selectionFromRun(
      output([
        { rank: 1, ref: 'pinned', gain: 0 },
        { rank: 2, ref: 'b', gain: 0 },
        { rank: 3, ref: 'swapped-in', gain: 7 },
      ])
    );
    expect(s?.saturationRank).toBe(1);
    expect(s?.saturatedCount).toBe(2);
    expect(s?.byRef['swapped-in'].saturated).toBe(false);
    expect(s?.byRef['b'].saturated).toBe(true);
  });

  it('treats a rounding artefact as zero, not as measurable value', () => {
    const s = selectionFromRun(
      output([
        { rank: 1, ref: 'a', gain: 5 },
        { rank: 2, ref: 'b', gain: 0.0004 },
      ])
    );
    expect(s?.saturationRank).toBe(2);
  });

  it('survives a malformed row rather than dropping the whole selection', () => {
    const s = selectionFromRun({
      budget: 14,
      selected: [{ rank: 1, ref: '2-1', gain: 9 }, { ref: null }, { rank: 'two', ref: 'x' }],
      displaced: [{ ref: '', wouldAdd: 1 }, { ref: '5-2', wouldAdd: 0.4, reason: 'nonsense' }],
    });
    expect(s?.selectedCount).toBe(1);
    // An unrecognised reason falls back to the ordinary one — it lost a round.
    expect(s?.byRef['5-2']).toMatchObject({ rank: 15, reason: 'outranked' });
  });

  it('reads the newest C3 run, which after a pin is seconds old', () => {
    const runs = [
      { step: 'C3', output: output([{ rank: 1, ref: 'after-pin', gain: 9 }]) },
      { step: 'C2', output: {} },
      { step: 'C3', output: output([{ rank: 1, ref: 'before-pin', gain: 9 }]) },
    ];
    expect(latestSelection(runs)?.byRef['after-pin']).toBeDefined();
    expect(latestSelection(runs)?.byRef['before-pin']).toBeUndefined();
    expect(latestSelection([{ step: 'C2', output: {} }])).toBeNull();
  });
});
