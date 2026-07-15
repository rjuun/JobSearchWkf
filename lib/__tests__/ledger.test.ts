import { describe, it, expect } from 'vitest';
import { buildLedger, type LedgerSnapshot, type LedgerActivity, type LedgerStory } from '../ledger';

const d = (iso: string) => new Date(iso);

describe('buildLedger', () => {
  it('is empty (with an inviting line) when no stream has fired', () => {
    const l = buildLedger([], [], [], d('2026-07-01'));
    expect(l.empty).toBe(true);
    expect(l.months).toHaveLength(0);
    expect(l.summaryLine).toMatch(/fills in/);
  });

  it('rolls the three streams into month buckets, newest first', () => {
    const snaps: LedgerSnapshot[] = [
      { score: 60, at: d('2026-05-10') },
      { score: 66, at: d('2026-05-20') },
      { score: 72, at: d('2026-06-15') },
    ];
    const activity: LedgerActivity[] = [
      { kind: 'evidence_kept', at: d('2026-05-11') },
      { kind: 'evidence_kept', at: d('2026-05-12') },
      { kind: 'cv_generated', at: d('2026-06-16') },
      { kind: 'target_flagged', at: d('2026-06-17') },
    ];
    const stories: LedgerStory[] = [{ at: d('2026-06-18') }];
    const l = buildLedger(snaps, activity, stories, d('2026-07-01'));

    expect(l.empty).toBe(false);
    expect(l.months.map((m) => m.key)).toEqual(['2026-06', '2026-05']); // newest first
    expect(l.currentStrength).toBe(72);
    expect(l.totalGain).toBe(12); // 60 → 72
    expect(l.totals.evidenceKept).toBe(2);
    expect(l.totals.cvsGenerated).toBe(1);
    expect(l.totals.storyVersions).toBe(1);

    const may = l.months.find((m) => m.key === '2026-05')!;
    expect(may.evidenceKept).toBe(2);
    expect(may.gained).toBe(6); // 60 → 66 within May
    expect(may.label).toBe('May 2026');

    const jun = l.months.find((m) => m.key === '2026-06')!;
    expect(jun.gained).toBe(6); // 66 → 72 attributable to June
    expect(jun.headline).toMatch(/graph \+6/);
  });

  it('self-gates: not substantive below the combined-signal threshold, substantive at/above it', () => {
    // 3 combined signals (2 activity + 1 snapshot) → still gathering.
    const thin = buildLedger(
      [{ score: 60, at: d('2026-06-10') }],
      [{ kind: 'evidence_kept', at: d('2026-06-11') }, { kind: 'cv_generated', at: d('2026-06-12') }],
      [],
      d('2026-06-20')
    );
    expect(thin.empty).toBe(false);
    expect(thin.substantive).toBe(false);

    // 5 combined signals → substantive.
    const rich = buildLedger(
      [{ score: 60, at: d('2026-06-10') }, { score: 66, at: d('2026-06-14') }],
      [{ kind: 'evidence_kept', at: d('2026-06-11') }, { kind: 'cv_generated', at: d('2026-06-12') }],
      [{ at: d('2026-06-13') }],
      d('2026-06-20')
    );
    expect(rich.substantive).toBe(true);
  });

  it('summary line names weeks and the honest build', () => {
    const l = buildLedger(
      [{ score: 50, at: d('2026-06-01') }, { score: 58, at: d('2026-06-20') }],
      [{ kind: 'evidence_kept', at: d('2026-06-02') }],
      [],
      d('2026-06-29')
    );
    expect(l.summaryLine).toMatch(/^In 4 weeks/);
    expect(l.summaryLine).toMatch(/\+8/);
  });
});
