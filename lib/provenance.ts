/**
 * M7 · Provenance coverage — the trust invariant, computed (never asserted).
 * Every line that reaches a generated CV must trace to an approved evidence node
 * (an `evidenceRef`). A row without a ref would be an unverifiable claim; this is
 * what the CV's "0 unverifiable claims / N lines, 100% traced" guarantee is measured from.
 */
export type ProvRow = {
  approvalStatus: string;
  evidenceRef: string | null;
  /** C3's verdict — non-null means this evidence is on the CV. Optional so
   *  callers with older row shapes still typecheck. */
  shortlistRank?: number | null;
};

export type ProvenanceCoverage = {
  green: number; //   lines that reach the CV
  traced: number; //  of those, how many carry an evidence ref
  complete: boolean; // green === traced → 100% (vacuously true when there are no lines)
  /** Whether C3 has run on this lead, i.e. whether `green` is the SELECTED set
   *  or the whole Keep set. The card's wording depends on it. */
  selected: boolean;
};

const has = (s: string | null | undefined) => !!s && s.trim().length > 0;

/**
 * Coverage over a set of tailoring rows. `effective` lets callers apply
 * optimistic overrides.
 *
 * Counted per distinct evidence ref, not per row: `requirement_tailoring` is one
 * row per requirement×evidence link and one bullet legitimately answers several
 * requirements, so counting rows told the owner his CV had 64 traced lines when
 * it had 35. Rows with no ref have nothing to collapse on and each count once —
 * they are precisely the untraced ones the guarantee exists to surface.
 *
 * Once C3 has run (CI · C3 Selects the CV Evidence Set), what reaches the CV is
 * the SHORTLISTED set, not every Kept row. Before it has run — or on a lead
 * generated before C3 shipped — no row carries a rank, and the whole Keep set is
 * still the honest answer.
 */
export function provenanceCoverage<T extends ProvRow>(
  rows: T[],
  effective: (r: T) => string = (r) => r.approvalStatus
): ProvenanceCoverage {
  const kept = rows.filter((r) => effective(r) === 'green');
  const shortlisted = kept.filter((r) => r.shortlistRank != null);
  const onCv = shortlisted.length > 0 ? shortlisted : kept;
  const seen = new Set<string>();
  let green = 0;
  let traced = 0;
  for (const r of onCv) {
    if (has(r.evidenceRef)) {
      const key = (r.evidenceRef as string).trim();
      if (seen.has(key)) continue;
      seen.add(key);
      traced += 1;
    }
    green += 1;
  }
  return { green, traced, complete: green === traced, selected: shortlisted.length > 0 };
}
