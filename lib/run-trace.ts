/**
 * Collapse `pipeline_runs` into one line per pipeline step for the lead page's
 * Run trace — while still saying when a step was run more than once.
 *
 * CI · Lead Liveness Re-check. The trace used to do this with a bare
 * `steps.map(step => runs.find(r => r.step === step))`, which silently kept the
 * newest run and dropped every earlier one. That was invisible until B1 became
 * genuinely re-runnable: a lead would show `B1 · 24 Aug` beside `B2–B6 · 4 Aug`
 * with nothing to say B1 had been *re-checked* rather than simply run later, and
 * the original run — the one whose bands the score was actually built on —
 * vanished from the record entirely.
 *
 * One line per step is still the right shape: the trace is a summary of the
 * pipeline, not a log, and an unbounded list would bury the steps that only ever
 * run once. So the newest run leads, and the repeat is annotated rather than
 * listed.
 *
 * Lives in `lib/` rather than beside the component because the repo's tsconfig
 * leaves `jsx: preserve`, so vitest cannot import a `.tsx` — testable logic has
 * to sit in a `.ts` file.
 */

export type RunTraceEntry = {
  step: string;
  model: string | null;
  finishedAt: string | null;
};

export type StepTrace = RunTraceEntry & {
  /** How many times this step has run. 1 for the ordinary case. */
  runCount: number;
  /** When it FIRST ran — null when it has only run once (nothing to compare). */
  firstAt: string | null;
};

/** Newest first; a run with no timestamp sorts last rather than winning by accident. */
function newestFirst(a: RunTraceEntry, b: RunTraceEntry): number {
  if (!a.finishedAt) return 1;
  if (!b.finishedAt) return -1;
  return b.finishedAt.localeCompare(a.finishedAt);
}

/**
 * `steps` fixes the display order, so the trace reads B1→B6 (or C1→C7) rather
 * than in whatever order the runs happen to arrive. Steps with no run at all are
 * omitted — "not run yet" is the absence of a line, as before.
 *
 * Deliberately does not trust the caller's ordering: it sorts each step's runs
 * itself. The one caller happens to pass them newest-first today, and a silent
 * dependency on that would make this wrong the moment the query changed.
 */
export function summariseRunTrace(runs: readonly RunTraceEntry[], steps: readonly string[]): StepTrace[] {
  const byStep = new Map<string, RunTraceEntry[]>();
  for (const run of runs) {
    if (!byStep.has(run.step)) byStep.set(run.step, []);
    byStep.get(run.step)!.push(run);
  }

  const out: StepTrace[] = [];
  for (const step of steps) {
    const forStep = byStep.get(step);
    if (!forStep?.length) continue;
    const sorted = [...forStep].sort(newestFirst);
    const latest = sorted[0];
    out.push({
      ...latest,
      runCount: sorted.length,
      firstAt: sorted.length > 1 ? sorted[sorted.length - 1].finishedAt : null,
    });
  }
  return out;
}

/** Total runs behind a summarised trace — what the header counts when a step has repeated. */
export function totalRuns(trace: readonly StepTrace[]): number {
  return trace.reduce((n, t) => n + t.runCount, 0);
}
