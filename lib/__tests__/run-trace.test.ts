/**
 * CI · Lead Liveness Re-check — the run-trace collapse.
 *
 * The shape that exposed the bug is the fixture: this lead's real
 * `pipeline_runs` had SEVEN rows (B1 twice, after a posting re-check) and the
 * trace drew six, silently dropping the original B1.
 */
import { describe, it, expect } from 'vitest';
import { summariseRunTrace, totalRuns, type RunTraceEntry } from '../run-trace';

const B_STEPS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'] as const;

// Lead ee5c72bf, verbatim shape: newest first, B1 twice.
const RUNS: RunTraceEntry[] = [
  { step: 'B1', model: 'code', finishedAt: '2026-08-24T10:43:26.000Z' },
  { step: 'B6', model: 'claude-opus-4-8', finishedAt: '2026-08-04T09:11:10.000Z' },
  { step: 'B5', model: 'claude-sonnet-5', finishedAt: '2026-08-04T09:10:08.000Z' },
  { step: 'B4', model: 'claude-sonnet-5', finishedAt: '2026-08-04T09:00:55.000Z' },
  { step: 'B3', model: 'claude-sonnet-5', finishedAt: '2026-08-04T09:00:49.000Z' },
  { step: 'B2', model: 'claude-sonnet-5', finishedAt: '2026-08-04T09:00:43.000Z' },
  { step: 'B1', model: 'code', finishedAt: '2026-08-04T09:00:16.000Z' },
];

describe('summariseRunTrace', () => {
  it('keeps one line per step, in the order the steps are given', () => {
    expect(summariseRunTrace(RUNS, B_STEPS).map((t) => t.step)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
  });

  it('reports the re-run instead of silently dropping it', () => {
    const b1 = summariseRunTrace(RUNS, B_STEPS).find((t) => t.step === 'B1')!;
    expect(b1.runCount).toBe(2);
    expect(b1.finishedAt).toBe('2026-08-24T10:43:26.000Z'); // latest leads
    expect(b1.firstAt).toBe('2026-08-04T09:00:16.000Z'); // original still reachable
  });

  it('leaves firstAt null for a step that only ran once — nothing to compare', () => {
    const b6 = summariseRunTrace(RUNS, B_STEPS).find((t) => t.step === 'B6')!;
    expect(b6.runCount).toBe(1);
    expect(b6.firstAt).toBeNull();
  });

  it('counts every run, so the header can say 7 where the list shows 6', () => {
    const trace = summariseRunTrace(RUNS, B_STEPS);
    expect(trace).toHaveLength(6);
    expect(totalRuns(trace)).toBe(7);
  });

  it('does not depend on the caller passing runs newest-first', () => {
    // The query happens to order them that way today. Relying on it silently
    // would make this wrong the moment the query changed.
    const b1 = summariseRunTrace([...RUNS].reverse(), B_STEPS).find((t) => t.step === 'B1')!;
    expect(b1.finishedAt).toBe('2026-08-24T10:43:26.000Z');
    expect(b1.firstAt).toBe('2026-08-04T09:00:16.000Z');
  });

  it('omits a step that has never run', () => {
    const trace = summariseRunTrace([{ step: 'B1', model: 'code', finishedAt: '2026-08-04T09:00:16.000Z' }], B_STEPS);
    expect(trace.map((t) => t.step)).toEqual(['B1']);
  });

  it('sorts a run with no timestamp last rather than letting it lead', () => {
    const trace = summariseRunTrace(
      [
        { step: 'B1', model: 'code', finishedAt: null },
        { step: 'B1', model: 'code', finishedAt: '2026-08-24T10:43:26.000Z' },
      ],
      B_STEPS
    );
    expect(trace[0].finishedAt).toBe('2026-08-24T10:43:26.000Z');
    expect(trace[0].runCount).toBe(2);
  });

  it('handles an empty trace', () => {
    expect(summariseRunTrace([], B_STEPS)).toEqual([]);
    expect(totalRuns([])).toBe(0);
  });
});
