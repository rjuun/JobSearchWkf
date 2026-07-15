import { describe, it, expect } from 'vitest';
import { discover, doorVerdict } from '../discover';
import { engine5Prompts } from '../coaching-queue';
import { EMPTY_TARGETS, type CareerGraph } from '../career-graph';

// Minimal graph builder — every array empty unless overridden.
function mkGraph(o: Partial<CareerGraph> = {}): CareerGraph {
  return {
    profile: { name: 'Test', headline: 'Senior finance & transformation leader' } as CareerGraph['profile'],
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
    ...o,
  };
}

describe('discover — Mirror + Unexpected Doors (C2)', () => {
  it('returns disjoint mirror/doors, all fits in range, mirror sorted desc', () => {
    const graph = mkGraph({
      skills: [
        { skill: 'Financial planning and forecasting' },
        { skill: 'Financial controlling' },
        { skill: 'Budgeting' },
        { skill: 'Stakeholder management' },
        { skill: 'Transformation and change' },
      ] as CareerGraph['skills'],
      bullets: [
        { text: 'Owned the group budgeting and forecasting cycle across regions' },
        { text: 'Led a finance transformation and process harmonisation programme' },
      ] as CareerGraph['bullets'],
    });
    const { mirror, doors } = discover(graph);

    for (const s of [...mirror, ...doors]) {
      expect(s.fit).toBeGreaterThanOrEqual(0);
      expect(s.fit).toBeLessThanOrEqual(10);
      expect(s.covered).toBeLessThanOrEqual(s.total);
    }
    // mirror is sorted by fit descending
    for (let i = 1; i < mirror.length; i++) expect(mirror[i - 1].fit).toBeGreaterThanOrEqual(mirror[i].fit);
    // no archetype appears in both lenses
    const keys = new Set(mirror.map((m) => m.key));
    expect(doors.some((d) => keys.has(d.key))).toBe(false);
    // rich finance evidence should surface at least one real match
    expect(mirror.length).toBeGreaterThan(0);
  });

  it('is empty-ish (no strong mirror) for an empty graph', () => {
    const { mirror } = discover(mkGraph());
    expect(mirror.length).toBe(0);
  });
});

describe('engine5Prompts — excavation (C3)', () => {
  it('invites on a thinly-documented role and stays lowest value', () => {
    const graph = mkGraph({
      positions: [{ refCode: 'P1', title: 'Head of Finance', company: 'Acme' }] as CareerGraph['positions'],
      stars: [] as CareerGraph['stars'], // 0 stories for P1 → thin
    });
    const out = engine5Prompts(graph);
    expect(out.length).toBe(1);
    expect(out[0].promptSource).toBe('excavation');
    expect(out[0].value).toBe(12);
    expect(out[0].tier).toBe('position_deep');
    expect(out[0].dedupeKey.startsWith('e5:')).toBe(true);
    expect(out[0].question).toContain('Head of Finance');
  });

  it('skips a role that already has two or more stories', () => {
    const graph = mkGraph({
      positions: [{ refCode: 'P1', title: 'Head of Finance', company: 'Acme' }] as CareerGraph['positions'],
      stars: [{ positionRef: 'P1' }, { positionRef: 'P1' }] as CareerGraph['stars'],
    });
    expect(engine5Prompts(graph).length).toBe(0);
  });
});

describe('doorVerdict — the honest Test-a-Door projection (R4)', () => {
  it('calls a strong, well-covered role a real adjacency', () => {
    const v = doorVerdict({ fit: 7.2, covered: 4, total: 5, gaps: ['X'] });
    expect(v.stance).toBe('adjacency');
    expect(v.line).toMatch(/adjacency/i);
  });

  it('names a middling fit a genuine stretch and quantifies the gaps', () => {
    const v = doorVerdict({ fit: 5, covered: 2, total: 6, gaps: ['A', 'B', 'C', 'D'] });
    expect(v.stance).toBe('stretch');
    expect(v.line).toMatch(/stretch/i);
    expect(v.line).toMatch(/4 gaps/);
    expect(v.strengthen).toEqual(['A', 'B']); // capped at two
  });

  it('is honest that a low fit is a reach, not a next move', () => {
    const v = doorVerdict({ fit: 3, covered: 1, total: 6, gaps: ['A', 'B', 'C'] });
    expect(v.stance).toBe('reach');
    expect(v.line).toMatch(/reach today/i);
  });

  it('does not flatter high fit with weak coverage into an adjacency', () => {
    // fit clears 6 but coverage ratio is thin — must not claim "adjacency".
    expect(doorVerdict({ fit: 6.5, covered: 2, total: 6, gaps: ['A', 'B', 'C', 'D'] }).stance).toBe('stretch');
  });
});
