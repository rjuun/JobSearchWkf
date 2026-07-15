/**
 * M7 · Provenance coverage — the trust invariant, computed (never asserted).
 * Every Kept line that reaches a generated CV must trace to an approved evidence node
 * (an `evidenceRef`). A green row without a ref would be an unverifiable claim; this is
 * what the CV's "0 unverifiable claims / N lines, 100% traced" guarantee is measured from.
 */
export type ProvRow = { approvalStatus: string; evidenceRef: string | null };

export type ProvenanceCoverage = {
  green: number; //   Kept lines (what reaches the CV)
  traced: number; //  of those, how many carry an evidence ref
  complete: boolean; // green === traced → 100% (vacuously true when there are no Kept lines)
};

const has = (s: string | null | undefined) => !!s && s.trim().length > 0;

/** Coverage over a set of tailoring rows. `effective` lets callers apply optimistic overrides. */
export function provenanceCoverage<T extends ProvRow>(
  rows: T[],
  effective: (r: T) => string = (r) => r.approvalStatus
): ProvenanceCoverage {
  const green = rows.filter((r) => effective(r) === 'green');
  const traced = green.filter((r) => has(r.evidenceRef));
  return { green: green.length, traced: traced.length, complete: green.length === traced.length };
}
