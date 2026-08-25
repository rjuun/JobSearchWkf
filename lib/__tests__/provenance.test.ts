import { describe, it, expect } from 'vitest';
import { provenanceCoverage, type ProvRow } from '../provenance';

const row = (approvalStatus: string, evidenceRef: string | null, shortlistRank: number | null = null): ProvRow => ({
  approvalStatus,
  evidenceRef,
  shortlistRank,
});

describe('provenance coverage (M7 invariant)', () => {
  it('is 100% when every Kept line carries an evidence ref', () => {
    const cov = provenanceCoverage([row('green', '2-1'), row('green', 'A-R5'), row('red', null), row('pending', null)]);
    expect(cov.green).toBe(2);
    expect(cov.traced).toBe(2);
    expect(cov.complete).toBe(true);
  });

  it('catches a Kept line with no evidence ref (an unverifiable claim)', () => {
    const cov = provenanceCoverage([row('green', '2-1'), row('green', null)]);
    expect(cov.green).toBe(2);
    expect(cov.traced).toBe(1);
    expect(cov.complete).toBe(false);
  });

  it('treats a blank ref as untraced', () => {
    expect(provenanceCoverage([row('green', '   ')]).complete).toBe(false);
  });

  it('is vacuously complete with no Kept lines', () => {
    expect(provenanceCoverage([row('red', null), row('pending', null)])).toEqual({
      green: 0,
      traced: 0,
      complete: true,
      selected: false,
    });
  });

  it('honours an effective() override (optimistic keep)', () => {
    const rows = [row('pending', 'X-1')];
    expect(provenanceCoverage(rows, () => 'green').traced).toBe(1);
  });

  // ── CI · C3 Selects the CV Evidence Set ────────────────────────────────────

  it('counts one line per distinct evidence ref, not one per requirement link', () => {
    // One bullet legitimately answers several requirements, so it arrives as
    // several green rows. Counting rows told the owner his CV had 64 traced
    // lines when the document held 35.
    const cov = provenanceCoverage([row('green', 'G1'), row('green', 'G1'), row('green', 'G1'), row('green', 'S1')]);
    expect(cov.green).toBe(2);
    expect(cov.traced).toBe(2);
  });

  it('counts the SHORTLISTED set once C3 has ranked anything', () => {
    const cov = provenanceCoverage([
      row('green', 'G1', 1),
      row('green', 'S1', 2),
      row('green', 'P9'), // Kept but not selected — not on the CV
      row('green', 'EDU-1'), // exempt from the budget, never ranked
    ]);
    expect(cov.green).toBe(2);
    expect(cov.selected).toBe(true);
  });

  it('falls back to the whole Keep set on a lead generated before C3 shipped', () => {
    // No row carries a rank there, and claiming "nothing is on the CV" would be
    // a worse answer than the pre-C3 one.
    const cov = provenanceCoverage([row('green', 'G1'), row('green', 'S1')]);
    expect(cov.green).toBe(2);
    expect(cov.selected).toBe(false);
  });

  it('still counts every ref-less line, since those are what the guarantee exists to surface', () => {
    const cov = provenanceCoverage([row('green', null), row('green', null)]);
    expect(cov.green).toBe(2);
    expect(cov.traced).toBe(0);
    expect(cov.complete).toBe(false);
  });
});
