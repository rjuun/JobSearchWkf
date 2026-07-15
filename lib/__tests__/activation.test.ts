import { describe, it, expect } from 'vitest';
import { computeActivation, formatDuration } from '../activation';

const at = (min: number) => new Date(Date.parse('2026-07-01T09:00:00Z') + min * 60_000);

describe('activation metrics (M5)', () => {
  it('measures time-to-first-CV and decisions-before-win from the paste', () => {
    const m = computeActivation([
      { kind: 'paste', at: at(0) },
      { kind: 'verdict', at: at(1) },
      { kind: 'keep', at: at(2) },
      { kind: 'keep', at: at(3) },
      { kind: 'cv_generated', at: at(4) },
      { kind: 'keep', at: at(9) }, // a later keep — not "before win"
    ]);
    expect(m.started).toBe(true);
    expect(m.firstCv).toBe(true);
    expect(m.timeToFirstCvMs).toBe(4 * 60_000);
    expect(m.decisionsBeforeWin).toBe(2);
    expect(m.totalKeeps).toBe(3);
  });

  it('counts coach approvals as decisions before win, but not as C2 Keeps (Issue 11)', () => {
    const m = computeActivation([
      { kind: 'paste', at: at(0) },
      { kind: 'coach_approval', at: at(1) },
      { kind: 'keep', at: at(2) },
      { kind: 'coach_approval', at: at(3) },
      { kind: 'cv_generated', at: at(4) },
    ]);
    expect(m.decisionsBeforeWin).toBe(3); // 2 coach approvals + 1 keep
    expect(m.totalKeeps).toBe(1); //         "Evidence kept" stays C2-only
  });

  it('is order-independent (sorts by time)', () => {
    const m = computeActivation([
      { kind: 'cv_generated', at: at(4) },
      { kind: 'paste', at: at(0) },
      { kind: 'keep', at: at(2) },
    ]);
    expect(m.timeToFirstCvMs).toBe(4 * 60_000);
    expect(m.decisionsBeforeWin).toBe(1);
  });

  it('counts the warm-up (no-job-ad) path as a start', () => {
    const m = computeActivation([{ kind: 'warmup', at: at(0) }, { kind: 'keep', at: at(1) }]);
    expect(m.started).toBe(true);
    expect(m.firstCv).toBe(false);
    expect(m.timeToFirstCvMs).toBeNull();
    expect(m.decisionsBeforeWin).toBeNull();
  });

  it('reports nothing before a paste', () => {
    const m = computeActivation([]);
    expect(m.started).toBe(false);
    expect(m.timeToFirstCvMs).toBeNull();
  });

  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(48_000)).toBe('48s');
    expect(formatDuration(4 * 60_000 + 12_000)).toBe('4m 12s');
  });
});
