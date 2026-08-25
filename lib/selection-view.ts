/**
 * The Map's reading of C3 — CI · C3 Selects the CV Evidence Set §2b.4.
 *
 * Selection is shown on the Requirement→Evidence Map: a rank on every approved
 * card, a solid outline on the ones that fit. All of that is read back out of
 * the C3 step's `pipeline_runs.output`, and **no new column is added for it**.
 *
 * `shortlist_rank` keeps its exact meaning — the selected rank, NULL when not
 * selected — because `C4`, `C5` and `scripts/verify-lead-run.ts` all read
 * `shortlist_rank != null` as "on the CV". Widening it to cover held-back rows,
 * or adding a parallel ranking column, would change a value three consumers
 * depend on for the sake of a display concern.
 *
 * Pure and DB-free on purpose, same reasoning as `lib/provenance.ts`: the
 * interesting behaviour here is the numbering and the saturation point, and
 * both have to be provable without Postgres.
 */

/** Gains below this are zero. The objective is a sum of a handful of terms
 *  rounded to three decimals in the step output, so exact `=== 0` would call a
 *  0.0004 rounding artefact "measurable value". */
const ZERO_GAIN = 1e-3;

export type MapSelectionCard = {
  /** 1..B for the selected set; `budget + 1` upward for what was held back. */
  rank: number;
  /** ΔV this evidence contributed, or would have contributed. */
  gain: number;
  selected: boolean;
  /** On the CV, and adding nothing measurable — the dashed outline. Decided by
   *  this card's own gain, not by its rank (see `saturationRank`). */
  saturated: boolean;
  /** Why it is not on the CV. Null for selected items. */
  reason: 'excluded' | 'position cap' | 'outranked' | null;
};

export type MapSelection = {
  budget: number;
  /** Evidence ref → its place in C3's order. Education and Language refs are
   *  absent: they never entered the budget, so they have no place in it. */
  byRef: Record<string, MapSelectionCard>;
  /**
   * The saturation point — the first selected rank whose marginal gain reaches
   * zero, which is where §2b's "second, lighter line" is drawn.
   *
   * **Rank order is not gain order**, and that had to be measured rather than
   * assumed. Greedy's own gains fall monotonically, but a pin enters ahead of
   * them carrying whatever gain it has and the swap pass appends its result at
   * the END of the order regardless of what it added — on the Allianz lead that
   * put a 0.3-gain item at rank 13 under six zeroes. So the line marks where the
   * zeroes START; whether a particular card is past saturation is decided by
   * that card's own gain (`saturated` below), never by its rank being under the
   * line. Reading it off the rank alone would have called that rank-13 item
   * worthless when it is the reason a swap happened at all.
   *
   * Null when nothing saturates — then the Map draws no second line, which is
   * §2b.6's own acceptance criterion.
   */
  saturationRank: number | null;
  /** Selected items adding no measurable value — the dashed ones. Equals the
   *  step report's own "filled past saturation" count. */
  saturatedCount: number;
  selectedCount: number;
  heldBackCount: number;
  /** How many distinct refs actually competed. Taken from the step report
   *  rather than counted off `byRef`, because the C3 runs recorded before this
   *  shipped stored only the ten strongest of the held-back items — counting
   *  the rows present would quietly understate what the budget was chosen from. */
  candidateCount: number;
};

type RawSelected = { ref?: unknown; rank?: unknown; gain?: unknown };
type RawDisplaced = { ref?: unknown; wouldAdd?: unknown; reason?: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const REASONS = ['excluded', 'position cap', 'outranked'] as const;

/**
 * Build the Map's selection model from a C3 step's stored output.
 *
 * Returns null for anything that is not a C3 run that actually selected —
 * a lead that has never been approved, or an output shape from before this
 * shipped. The Map then renders exactly as it did before: colours for approval,
 * no ranks, no outlines. A partial render would be worse than none, because a
 * missing rank badge reads as "C3 held this back".
 */
export function selectionFromRun(output: unknown): MapSelection | null {
  if (!isRecord(output)) return null;
  const selected = Array.isArray(output.selected) ? (output.selected as RawSelected[]) : null;
  if (!selected || selected.length === 0) return null;
  const budget = num(output.budget) ?? selected.length;

  const byRef: Record<string, MapSelectionCard> = {};
  const ranked: { rank: number; gain: number }[] = [];
  for (const s of selected) {
    if (typeof s.ref !== 'string' || !s.ref) continue;
    const rank = num(s.rank);
    if (rank == null) continue;
    const gain = num(s.gain) ?? 0;
    byRef[s.ref] = { rank, gain, selected: true, saturated: gain <= ZERO_GAIN, reason: null };
    ranked.push({ rank, gain });
  }
  if (ranked.length === 0) return null;

  // Held-back ranks continue past the budget line, in the order of the gain
  // each would have added — which is what makes the near-misses visible as
  // near-misses rather than as an undifferentiated leftover pile. `displaced`
  // arrives already sorted by that gain, ties broken on ref.
  const displaced = Array.isArray(output.displaced) ? (output.displaced as RawDisplaced[]) : [];
  let next = budget + 1;
  let heldBackCount = 0;
  for (const d of displaced) {
    if (typeof d.ref !== 'string' || !d.ref || byRef[d.ref]) continue;
    const reason = REASONS.find((r) => r === d.reason) ?? 'outranked';
    byRef[d.ref] = { rank: next++, gain: num(d.wouldAdd) ?? 0, selected: false, saturated: false, reason };
    heldBackCount += 1;
  }

  ranked.sort((a, b) => a.rank - b.rank);
  const first = ranked.find((r) => r.gain <= ZERO_GAIN);
  const saturationRank = first ? first.rank : null;
  const saturatedCount = ranked.filter((r) => r.gain <= ZERO_GAIN).length;

  return {
    budget,
    byRef,
    saturationRank,
    saturatedCount,
    selectedCount: ranked.length,
    heldBackCount,
    candidateCount: num(output.candidates) ?? ranked.length + heldBackCount,
  };
}

/**
 * The newest C3 run's selection, from a lead's run list.
 *
 * `getPipelineRuns` orders newest-first, so the first C3 row is the standing
 * verdict — and after a pin, an exclude or a Keep change it is a run seconds
 * old, because every one of those re-solves (§2b.5 item 3).
 */
export function latestSelection(runs: readonly { step: string; output: unknown }[]): MapSelection | null {
  const c3 = runs.find((r) => r.step === 'C3');
  return c3 ? selectionFromRun(c3.output) : null;
}
