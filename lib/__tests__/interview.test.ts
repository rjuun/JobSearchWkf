import { describe, it, expect } from 'vitest';
import { buildInterviewBrief, graphLessonLine, type BriefReq, type BriefTailoring } from '../interview';

const req = (o: Partial<BriefReq> = {}): BriefReq => ({
  requirement: 'Lead a finance transformation',
  rank: 'Core',
  description: null,
  initialMatchStrength: 'Strong',
  ...o,
});
const row = (o: Partial<BriefTailoring> = {}): BriefTailoring => ({
  requirementLine: 'Owned P&L',
  cvBullet: 'Owned a €40M P&L across 3 markets',
  originalText: 'Ran the numbers',
  evidenceRef: 'tbl_STAR_Actions > 5-3',
  connectionToExpertise: 'Strong · direct ownership',
  approvalStatus: 'green',
  ...o,
});

describe('buildInterviewBrief', () => {
  it('projects kept (green) rows as proof points, carrying ref + connection', () => {
    const b = buildInterviewBrief([], [row(), row({ approvalStatus: 'pending' })]);
    expect(b.proofPoints).toHaveLength(1);
    expect(b.proofPoints[0]).toEqual({
      bullet: 'Owned a €40M P&L across 3 markets',
      ref: 'tbl_STAR_Actions > 5-3',
      connection: 'Strong · direct ownership',
    });
    expect(b.counts.proof).toBe(1);
  });

  it('lists Core/Important requirements as probes, drops Nice-to-have', () => {
    const b = buildInterviewBrief(
      [req({ rank: 'Core' }), req({ requirement: 'SAP', rank: 'Important' }), req({ requirement: 'German', rank: 'Nice' })],
      []
    );
    expect(b.probes.map((p) => p.requirement)).toEqual(['Lead a finance transformation', 'SAP']);
  });

  it('surfaces Weak/No Match/Partial requirements as honest bridges', () => {
    const b = buildInterviewBrief(
      [req({ requirement: 'US GAAP', initialMatchStrength: 'Weak' }), req({ requirement: 'M&A', initialMatchStrength: 'No Match' }), req()],
      []
    );
    expect(b.bridges.map((x) => x.requirement)).toEqual(['US GAAP', 'M&A']);
  });

  it('drops a weak requirement from bridges once kept (green) evidence covers it', () => {
    const b = buildInterviewBrief(
      [
        req({ requirement: 'US GAAP', initialMatchStrength: 'Weak' }),
        req({ requirement: 'M&A', initialMatchStrength: 'No Match' }),
      ],
      // A kept row addressing US GAAP (matched loosely on requirementLine) — no longer a gap.
      [row({ requirementLine: ' us gaap ', approvalStatus: 'green' })]
    );
    expect(b.bridges.map((x) => x.requirement)).toEqual(['M&A']);
    // A non-green row for the same requirement would NOT clear the bridge.
    const b2 = buildInterviewBrief(
      [req({ requirement: 'US GAAP', initialMatchStrength: 'Weak' })],
      [row({ requirementLine: 'US GAAP', approvalStatus: 'yellow' })]
    );
    expect(b2.bridges.map((x) => x.requirement)).toEqual(['US GAAP']);
  });

  it('reframes dropped (red) rows as "left out, on purpose" honest answers', () => {
    const b = buildInterviewBrief([], [row({ approvalStatus: 'red', originalText: 'Managed a small team' })]);
    expect(b.leftOut).toHaveLength(1);
    expect(b.leftOut[0].note).toBe('Managed a small team');
    expect(b.proofPoints).toHaveLength(0);
  });

  it('graph lesson names thin spots honestly, and stays quiet when none', () => {
    expect(graphLessonLine(0, 0)).toMatch(/Keep evidence/);
    expect(graphLessonLine(3, 0)).toMatch(/must-haves are covered/);
    expect(graphLessonLine(3, 2)).toMatch(/still thin on/);
  });
});
