import { describe, it, expect } from 'vitest';
import {
  strengthOf,
  EMPTY_TARGETS,
  evidenceTokens,
  graphCoversRequirement,
  salientTerms,
  type CareerGraph,
  type TargetCoverage,
} from '../career-graph';

const NOW = Date.parse('2026-07-01T00:00:00Z');

/** Build a graph with tunable signals. Rows are minimal — only the fields strengthOf reads. */
function mkGraph(o: {
  positions?: number;
  stars?: number;
  storiesWithMetric?: number; // of `stars`, how many have a quantified result
  skills?: number;
  skillsWithAts?: number;
  edu?: number;
  langs?: number;
  bullets?: number;
  updatedAt?: number; // ms; defaults to NOW (fresh)
  targets?: TargetCoverage;
} = {}): CareerGraph {
  const {
    positions = 4, stars = 6, storiesWithMetric = 6, skills = 20, skillsWithAts = 20,
    edu = 1, langs = 1, bullets = 5, updatedAt = NOW, targets = EMPTY_TARGETS,
  } = o;
  const when = new Date(updatedAt);
  const rows = (n: number, extra: (i: number) => object = () => ({})) =>
    Array.from({ length: n }, (_, i) => ({ id: String(i), createdAt: when, updatedAt: when, ...extra(i) }));
  return {
    profile: { name: 'Test Person' } as CareerGraph['profile'],
    positions: rows(positions) as CareerGraph['positions'],
    stars: rows(stars, (i) => ({ refCode: `s${i}` })) as CareerGraph['stars'],
    actions: [] as CareerGraph['actions'],
    results: rows(stars, (i) => ({ starRef: `s${i}`, metric: i < storiesWithMetric ? '€1M' : null })) as CareerGraph['results'],
    competences: [] as CareerGraph['competences'],
    attributes: [] as CareerGraph['attributes'],
    responsibilities: [] as CareerGraph['responsibilities'],
    education: rows(edu) as CareerGraph['education'],
    languages: rows(langs) as CareerGraph['languages'],
    bullets: rows(bullets) as CareerGraph['bullets'],
    skills: rows(skills, (i) => ({ atsKeywordVariants: i < skillsWithAts ? ['kw'] : [] })) as CareerGraph['skills'],
    targets,
  };
}

describe('strengthOf — compounding, never-saturating model', () => {
  it('is deterministic given the same inputs', () => {
    const g = mkGraph();
    expect(strengthOf(g, NOW)).toEqual(strengthOf(g, NOW));
  });

  it('never saturates — even a maximal graph with heavy coverage stays under 100', () => {
    const g = mkGraph({
      positions: 8, stars: 12, storiesWithMetric: 12, skills: 40, skillsWithAts: 40, bullets: 30,
      targets: { flaggedLeads: 10, requirements: 500, covered: 500, open: 0 },
    });
    const s = strengthOf(g, NOW);
    expect(s.score).toBeLessThan(100);
  });

  it('relevancy grows with covered target requirements', () => {
    const base = mkGraph({ targets: { flaggedLeads: 1, requirements: 20, covered: 0, open: 20 } });
    const more = mkGraph({ targets: { flaggedLeads: 1, requirements: 20, covered: 12, open: 8 } });
    const rel = (g: CareerGraph) => strengthOf(g, NOW).components.find((c) => c.key === 'relevancy')!.earned;
    expect(rel(more)).toBeGreaterThan(rel(base));
    expect(strengthOf(more, NOW).score).toBeGreaterThan(strengthOf(base, NOW).score);
  });

  it('flagging a target raises the ceiling (unlocks the relevancy dimension)', () => {
    const none = strengthOf(mkGraph({ targets: EMPTY_TARGETS }), NOW);
    const flagged = strengthOf(mkGraph({ targets: { flaggedLeads: 1, requirements: 6, covered: 0, open: 6 } }), NOW);
    expect(flagged.ceiling).toBeGreaterThan(none.ceiling);
    expect(none.ceiling).toBe(75);
    expect(flagged.ceiling).toBe(100);
  });

  it('flagging an uncovered target never drops the earned score (headroom, not loss)', () => {
    const before = strengthOf(mkGraph({ targets: { flaggedLeads: 1, requirements: 10, covered: 4, open: 6 } }), NOW);
    // Flag another target with more requirements but nothing newly covered.
    const after = strengthOf(mkGraph({ targets: { flaggedLeads: 2, requirements: 25, covered: 4, open: 21 } }), NOW);
    expect(after.score).toBe(before.score); // relevancy depends only on covered
    expect(after.headroom).toBeGreaterThanOrEqual(before.headroom);
  });

  it('freshness decays as evidence ages', () => {
    const fresh = strengthOf(mkGraph({ updatedAt: NOW }), NOW);
    const stale = strengthOf(mkGraph({ updatedAt: NOW - 365 * 86_400_000 }), NOW);
    const fr = (s: ReturnType<typeof strengthOf>) => s.components.find((c) => c.key === 'freshness')!.earned;
    expect(fr(stale)).toBeLessThan(fr(fresh));
    expect(stale.score).toBeLessThan(fresh.score);
  });

  it('an empty graph shows the relevancy dimension as locked', () => {
    const s = strengthOf(mkGraph({ targets: EMPTY_TARGETS }), NOW);
    expect(s.components.find((c) => c.key === 'relevancy')!.locked).toBeTruthy();
  });
});

describe('live requirement coverage (Issue 5)', () => {
  /** A graph whose only evidence is one STAR with the given title/summary text. */
  const graphWith = (text: string): CareerGraph =>
    ({
      profile: null, positions: [], actions: [], results: [], competences: [], attributes: [],
      responsibilities: [], education: [], languages: [], bullets: [], skills: [],
      stars: [{ title: text, summary: '' }] as CareerGraph['stars'],
      targets: EMPTY_TARGETS,
    }) as CareerGraph;

  it('salientTerms drops stopwords and short filler', () => {
    const terms = salientTerms('Led the post-merger integration across the group');
    expect(terms).toContain('post-merger');
    expect(terms).toContain('integration');
    expect(terms).not.toContain('led');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('across');
  });

  it('covers a requirement when a majority of its salient terms are evidenced', () => {
    const tokens = evidenceTokens(graphWith('Ran a post-merger integration of two finance functions'));
    expect(graphCoversRequirement('post-merger integration experience', tokens)).toBe(true);
  });

  it('does NOT cover a requirement the graph never mentions', () => {
    const tokens = evidenceTokens(graphWith('Ran a post-merger integration of two finance functions'));
    expect(graphCoversRequirement('regulatory reporting under Basel III', tokens)).toBe(false);
  });

  it('matches whole words only — "board" does not match "dashboard"', () => {
    const tokens = evidenceTokens(graphWith('Built the executive dashboard suite'));
    expect(graphCoversRequirement('board reporting', tokens)).toBe(false);
  });

  it('an all-stopword requirement is never falsely marked covered', () => {
    const tokens = evidenceTokens(graphWith('anything at all'));
    expect(graphCoversRequirement('with the and for', tokens)).toBe(false);
  });
});
