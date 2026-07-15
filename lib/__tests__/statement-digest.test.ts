import { describe, it, expect } from 'vitest';
import { digestHeadline, summarizeStatement, digestIsSubstantive, type StatementDigest } from '../activity';

const totals = (kinds: string[]) => summarizeStatement(kinds.map((kind) => ({ kind })));
const digest = (kinds: string[]): StatementDigest => ({
  since: new Date('2026-06-01'),
  newCount: kinds.length,
  totals: totals(kinds),
  latest: [],
});

describe('digestHeadline', () => {
  it('is quiet when nothing accrued', () => {
    expect(digestHeadline(totals([]))).toBe('Nothing new yet.');
  });

  it('singular vs plural, one kind', () => {
    expect(digestHeadline(totals(['evidence_kept']))).toBe('1 piece of evidence kept');
    expect(digestHeadline(totals(['cv_generated', 'cv_generated']))).toBe('2 CVs tailored');
  });

  it('joins two kinds with "and"', () => {
    expect(digestHeadline(totals(['evidence_kept', 'applied']))).toBe(
      '1 piece of evidence kept and 1 application sent'
    );
  });

  it('caps at the three loudest and tallies the rest as "and N more"', () => {
    const line = digestHeadline(
      totals(['evidence_kept', 'coach_approved', 'cv_generated', 'target_flagged', 'applied'])
    );
    // 5 distinct kinds → first three named, remaining two folded in.
    expect(line).toMatch(/and 2 more$/);
    expect(line.startsWith('1 piece of evidence kept, 1 coached answer, 1 CV tailored')).toBe(true);
  });
});

describe('digestIsSubstantive (R3 self-gate)', () => {
  it('suppresses a lone event or a thin same-kind pair', () => {
    expect(digestIsSubstantive(digest(['coach_approved']))).toBe(false);
    expect(digestIsSubstantive(digest(['coach_approved', 'coach_approved']))).toBe(false);
  });

  it('fires on 3+ events, or on two different kinds', () => {
    expect(digestIsSubstantive(digest(['coach_approved', 'coach_approved', 'coach_approved']))).toBe(true);
    expect(digestIsSubstantive(digest(['evidence_kept', 'cv_generated']))).toBe(true);
  });
});
