import { describe, it, expect } from 'vitest';
import { provenanceCoverage, type ProvRow } from '../provenance';

const row = (approvalStatus: string, evidenceRef: string | null): ProvRow => ({ approvalStatus, evidenceRef });

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
    expect(provenanceCoverage([row('red', null), row('pending', null)])).toEqual({ green: 0, traced: 0, complete: true });
  });

  it('honours an effective() override (optimistic keep)', () => {
    const rows = [row('pending', 'X-1')];
    expect(provenanceCoverage(rows, () => 'green').traced).toBe(1);
  });
});
