import { describe, it, expect } from 'vitest';
import { summarizeStatement } from '../activity';

describe('summarizeStatement (Additive Plan · B1)', () => {
  it('is all-zero on an empty stream', () => {
    const t = summarizeStatement([]);
    expect(t.total).toBe(0);
    expect(t.evidenceKept).toBe(0);
    expect(t.applied).toBe(0);
  });

  it('counts each kind independently and totals every row', () => {
    const rows = [
      { kind: 'evidence_kept' },
      { kind: 'evidence_kept' },
      { kind: 'coach_approved' },
      { kind: 'target_flagged' },
      { kind: 'screening' },
      { kind: 'cv_generated' },
      { kind: 'applied' },
      { kind: 'outcome' },
    ];
    const t = summarizeStatement(rows);
    expect(t.evidenceKept).toBe(2);
    expect(t.coachApproved).toBe(1);
    expect(t.targetsFlagged).toBe(1);
    expect(t.screened).toBe(1);
    expect(t.cvsGenerated).toBe(1);
    expect(t.applied).toBe(1);
    expect(t.outcomes).toBe(1);
    expect(t.total).toBe(rows.length);
  });

  it('ignores unknown kinds in the per-kind counts but still totals them', () => {
    const t = summarizeStatement([{ kind: 'evidence_kept' }, { kind: 'mystery' }]);
    expect(t.evidenceKept).toBe(1);
    expect(t.total).toBe(2);
  });
});
