/**
 * M2 guardrails: the coach's draft never invents a metric, and the two
 * generation engines surface the right prompts from the right inputs.
 * All pure — no DB, no network, no LLM.
 */
import { describe, it, expect } from 'vitest';
import { mockDraft, groundDraft } from '../coaching-draft';
import {
  engine1Prompts,
  engine2Prompts,
  engine3Prompts,
  engine4Prompts,
  spawnTemplate,
  heroOf,
  missingDesiredDisposition,
  VALUE,
  type DesiredPrompt,
  type TargetReqRow,
  type MisalignmentRow,
  type QueueGroup,
} from '../coaching-queue';
import { atsBundleEdits } from '../coaching-commit';
import { EMPTY_TARGETS, type CareerGraph } from '../career-graph';

describe('coach draft — never invent a metric', () => {
  it('leaves metric null + needsMetric true when no number was given', () => {
    const d = mockDraft('I led the regulatory remediation programme to a clean close');
    expect(d.metric).toBeNull();
    expect(d.needsMetric).toBe(true);
  });

  it('keeps a number the user actually supplied', () => {
    const d = mockDraft('cut the month-end close from 20 days to 5');
    expect(d.metric).toBe('20 days');
    expect(d.needsMetric).toBe(false);
  });

  it('strips a metric the model hallucinated that is not in the answer', () => {
    const grounded = groundDraft(
      { action: 'Owned the budget', result: 'improved accuracy', metric: '€5M', needsMetric: false, confidence: 0.6 },
      'I owned the budget and improved accuracy — no figure to hand'
    );
    expect(grounded.metric).toBeNull();
    expect(grounded.needsMetric).toBe(true);
  });

  it('keeps a metric that is grounded in the answer', () => {
    const grounded = groundDraft(
      { action: 'Cut cost', result: 'saved €5M', metric: '€5M', needsMetric: false, confidence: 0.6 },
      'we saved €5M annually'
    );
    expect(grounded.metric).toBe('€5M');
    expect(grounded.needsMetric).toBe(false);
  });
});

function emptyGraph(): CareerGraph {
  return {
    profile: null,
    positions: [],
    stars: [],
    actions: [],
    results: [],
    competences: [],
    attributes: [],
    responsibilities: [],
    education: [],
    languages: [],
    bullets: [],
    skills: [],
    targets: EMPTY_TARGETS,
  };
}

describe('engine 1 — prior-role gaps', () => {
  it('asks for a metric on a story that has no quantified result', () => {
    const g = emptyGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.stars = [{ id: 's1', refCode: 'S1', title: 'Led a 4-year turnaround', summary: null } as any];
    g.results = []; // no result → no metric
    const prompts = engine1Prompts(g);
    const p = prompts.find((x) => x.promptSource === 'prior_roles' && x.tier === 'position_deep');
    expect(p).toBeTruthy();
    expect(p!.dedupeKey).toContain('s1');
  });

  it('produces nothing when a story already has a quantified result', () => {
    const g = emptyGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.stars = [{ id: 's1', refCode: 'S1', title: 'Done', summary: 'x' } as any];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.results = [{ id: 'r1', starRef: 'S1', text: 'saved', metric: '22%' } as any];
    expect(engine1Prompts(g).some((p) => p.dedupeKey === 'e1:metric:s1')).toBe(false);
  });
});

describe('engine 3 — target-role demand-pull', () => {
  const row = (over: Partial<TargetReqRow>): TargetReqRow => ({
    leadId: 'l1',
    leadTitle: 'COO',
    company: 'Acme',
    requirementId: 'r1',
    requirement: 'P&L ownership above €200M',
    rank: 'Core',
    initialScore: null,
    initialMatchStrength: null,
    ...over,
  });

  it('emits a relevancy prompt for a weak Core requirement', () => {
    const prompts = engine3Prompts([row({})]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].tier).toBe('relevancy');
    expect(prompts[0].promptSource).toBe('target_requirements');
  });

  it('excludes strongly-evidenced requirements', () => {
    const prompts = engine3Prompts([row({ initialScore: 8, initialMatchStrength: 'Very Strong' })]);
    expect(prompts).toHaveLength(0);
  });

  it('groups the same requirement across roles into one prompt', () => {
    const prompts = engine3Prompts([row({ requirementId: 'a' }), row({ requirementId: 'b', leadId: 'l2' })]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].payoff).toContain('2 roles');
  });
});

describe('engine 2 — similar leaders (corpus)', () => {
  it('asks about a competence the graph does not mention', () => {
    const prompts = engine2Prompts(emptyGraph());
    expect(prompts.some((p) => p.promptSource === 'similar_resumes' && /regulatory/i.test(p.question))).toBe(true);
  });

  it('skips a competence the graph already evidences', () => {
    const g = emptyGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.skills = [{ id: 'k1', skill: 'Regulatory compliance (EBA)' } as any];
    expect(engine2Prompts(g).some((p) => /regulatory/i.test(p.question))).toBe(false);
  });

  it('matches whole words only — "dashboard" does not count as "board"', () => {
    const g = emptyGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.responsibilities = [{ id: 'r1', text: 'Built executive dashboards and customer automation' } as any];
    // Board/C-suite and operating-model (TOM) prompts must still fire.
    expect(engine2Prompts(g).some((p) => /board|C-suite/i.test(p.question))).toBe(true);
  });
});

describe('engine 4 — screening gaps (B → Coach bridge)', () => {
  const mis = (over: Partial<MisalignmentRow>): MisalignmentRow => ({
    leadId: 'l1',
    leadTitle: 'Director, Strategy & Ops',
    company: 'Northwind',
    dimension: 'P&L scale',
    detail: 'Role wants €200M+; evidence tops out at €140M',
    severity: null,
    ...over,
  });

  it('turns a misalignment into a screening_gap prompt', () => {
    const prompts = engine4Prompts([mis({})]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].promptSource).toBe('screening_gap');
    expect(prompts[0].sourceRef).toMatchObject({ leadId: 'l1' });
  });

  it('de-dupes the same dimension on the same lead', () => {
    expect(engine4Prompts([mis({}), mis({ detail: 'phrased differently' })])).toHaveLength(1);
  });

  it('skips a checked-but-fine (benign) dimension', () => {
    expect(engine4Prompts([mis({ dimension: 'city', detail: 'Amsterdam (Primary — no misalignment)' })])).toHaveLength(0);
  });

  it("trusts B3's severity='none' as benign", () => {
    expect(engine4Prompts([mis({ severity: 'none' })])).toHaveLength(0);
  });

  it('does NOT suppress a genuine "misaligned"/"not acceptable" gap (regex regression)', () => {
    expect(engine4Prompts([mis({ dimension: 'Seniority', detail: 'role misaligned with tenure' })])).toHaveLength(1);
    expect(engine4Prompts([mis({ dimension: 'Comp', detail: 'not acceptable for the band' })])).toHaveLength(1);
  });
});

describe('M2 — ATS bundling', () => {
  it('collapses N skills without ATS variants into ONE bundled prompt', () => {
    const g = emptyGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.skills = ['Controlling', 'FP&A', 'ERP', 'Governance', 'M&A'].map((s, i) => ({ id: `k${i}`, skill: s, atsKeywordVariants: [] } as any));
    const bundles = engine1Prompts(g).filter((p) => (p.targetNode as { kind?: string })?.kind === 'ats_bundle');
    expect(bundles).toHaveLength(1);
    expect((bundles[0].targetNode as { skills: unknown[] }).skills).toHaveLength(5);
    expect(bundles[0].dedupeKey).toMatch(/^e1:ats-bundle:/);
  });

  it('gives the bundle a set-derived key so a changed skill set re-prompts', () => {
    const key = (names: string[]) => {
      const g = emptyGraph();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      g.skills = names.map((s, i) => ({ id: `k${i}`, skill: s, atsKeywordVariants: [] } as any));
      return engine1Prompts(g).find((p) => (p.targetNode as { kind?: string })?.kind === 'ats_bundle')!.dedupeKey;
    };
    expect(key(['A', 'B'])).toBe(key(['A', 'B'])); // order-independent, stable
    expect(key(['A', 'B'])).not.toBe(key(['A', 'B', 'C'])); // a new skill → new prompt
  });

  it('emits no ATS bundle when every skill already has variants', () => {
    const g = emptyGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.skills = [{ id: 'k1', skill: 'Controlling', atsKeywordVariants: ['FP&A'] } as any];
    expect(engine1Prompts(g).some((p) => (p.targetNode as { kind?: string })?.kind === 'ats_bundle')).toBe(false);
  });

  it('coalesces duplicate skill lines before writing revert snapshots', () => {
    const edits = atsBundleEdits('Controlling: FP&A\nControlling: management accounting, variance analysis', [
      { id: 'k1', name: 'Controlling' },
    ]);
    expect(edits).toEqual([{ id: 'k1', variants: ['FP&A', 'management accounting', 'variance analysis'] }]);
  });
});

describe('M2 — queue reconciliation', () => {
  it('parks stale target prompts instead of marking them done', () => {
    expect(
      missingDesiredDisposition({
        status: 'open',
        promptSource: 'target_requirements',
        spawnedBy: null,
        dedupeKey: 'e3:p&l ownership',
      })
    ).toBe('park');
  });

  it('still closes resolved non-target engine prompts', () => {
    expect(
      missingDesiredDisposition({
        status: 'open',
        promptSource: 'prior_roles',
        spawnedBy: null,
        dedupeKey: 'e1:metric:s1',
      })
    ).toBe('close');
  });
});

describe('M2 — cross-engine value ranking', () => {
  const targetRow = (over: Partial<TargetReqRow>): TargetReqRow => ({
    leadId: 'l1', leadTitle: 'COO', company: 'Acme', requirementId: 'r1',
    requirement: 'P&L ownership', rank: 'Core', initialScore: null, initialMatchStrength: null, ...over,
  });
  const misRow = (over: Partial<MisalignmentRow>): MisalignmentRow => ({
    leadId: 'l1', leadTitle: 'COO', company: 'Acme', dimension: 'P&L scale', detail: 'wants more', severity: null, ...over,
  });

  it('ranks screening_gap > target Core > metric > similar_resume > ATS bundle', () => {
    const g = emptyGraph();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.stars = [{ id: 's1', refCode: 'S1', title: 'Turnaround', summary: null } as any];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.skills = [{ id: 'k1', skill: 'Controlling', atsKeywordVariants: [] } as any];
    const desired: DesiredPrompt[] = [
      ...engine1Prompts(g), // metric (55) + ats bundle (25)
      ...engine2Prompts(g), // similar (35)
      ...engine3Prompts([targetRow({})]), // target Core, one role (84)
      ...engine4Prompts([misRow({})]), // screening_gap (95)
    ];
    const order = [...desired].sort((a, b) => b.value - a.value).map((d) => d.promptSource);
    expect(order[0]).toBe('screening_gap');
    expect(order[1]).toBe('target_requirements');
    // the two prior_roles (metric 55, then ats 25) straddle similar_resumes (35)
    const values = [...desired].sort((a, b) => b.value - a.value).map((d) => d.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(desired.find((d) => d.promptSource === 'screening_gap')!.value).toBe(VALUE.screeningGap);
  });

  it('a target Core asked by more roles outranks one asked by fewer, but stays below a screening gap', () => {
    const one = engine3Prompts([targetRow({})])[0].value;
    const many = engine3Prompts([targetRow({ requirementId: 'a' }), targetRow({ requirementId: 'b', leadId: 'l2' }), targetRow({ requirementId: 'c', leadId: 'l3' })])[0].value;
    expect(many).toBeGreaterThan(one);
    expect(many).toBeLessThan(VALUE.screeningGap);
  });

  it('heroOf returns the single highest-value open prompt', () => {
    const groups: QueueGroup[] = [
      { tier: 'basics', label: 'Basics', items: [{ id: 'a', value: 25 } as never] },
      { tier: 'relevancy', label: 'Rel', items: [{ id: 'b', value: 95 } as never, { id: 'c', value: 88 } as never] },
    ];
    expect(heroOf(groups)!.id).toBe('b');
  });
});

describe('spawn — a deeper follow-up', () => {
  it('opens an ownership/duration follow-up after a budget answer', () => {
    expect(spawnTemplate('I owned a €210M budget')?.payoff).toContain('ownership');
  });
  it('opens a scale/outcome follow-up after a team answer', () => {
    expect(spawnTemplate('I led a team of 40')?.payoff).toContain('scale');
  });
  it('does not spawn from an answer with no obvious depth', () => {
    expect(spawnTemplate('I attended some meetings')).toBeNull();
  });
});
