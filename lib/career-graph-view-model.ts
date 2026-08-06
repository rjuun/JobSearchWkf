/**
 * Career Graph — force-graph view model.
 *
 * Pure data transform: `CareerGraph` (flat Drizzle rows) → nodes/links for the
 * interactive graph in `components/roleproof/career-graph-view.tsx`. No D3 here —
 * keeping the shaping logic testable and framework-free.
 *
 * Relationships follow the model agreed on the design mockup (docs/design/career-graph-visualization.html):
 * Position→STAR (1:many via `stars.positionRef` = `positions.refCode`), STAR→Action,
 * STAR→Result (both via `*.starRef` = `stars.refCode`), Position→Responsibility (via
 * `responsibilities.positionRef`), and STAR→Competence/Attribute — competences and
 * attributes that repeat under the same name across STARs (workbook logs a fresh row
 * per story rather than a shared entry) are collapsed into one node with a link to
 * every STAR that demonstrates it, the same pattern skills already use via
 * `skillsMaster.starEvidence`.
 *
 * Fidelity note vs. the design mockup: the mockup was built directly from the Excel
 * workbook, which carries richer columns than the live schema — separate
 * Situation/Task text, competence/attribute descriptions, position seniority/location,
 * and free-text bullet source citations that produced real bullet→evidence edges. None
 * of those columns exist in `lib/db/schema.ts` today, so this live version omits them
 * rather than inventing them. CV Bullets link to a position only when `cvPosition`
 * text-matches a position title, and to a skill only when one of the bullet's `tags`
 * exactly matches a skill name — both called out in `GRAPH_FOOTNOTE` below so the UI
 * stays honest about what's a stored relationship vs. a best-effort text match.
 */
import type { CareerGraph } from './career-graph';

export type NodeType = 'position' | 'star' | 'action' | 'result' | 'responsibility' | 'competence' | 'attribute' | 'skill' | 'bullet';

export type GraphNode = {
  id: string;
  type: NodeType;
  label: string;
  sub?: string;
  /** For simulation state — mutated in place by d3-force. */
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  data: unknown;
};

export type LinkKind = 'contains' | 'evidence' | 'bullet-slot' | 'bullet-tag';

export type GraphLink = {
  source: string;
  target: string;
  kind: LinkKind;
};

export type CompetenceGroup = { name: string; starIds: string[]; starRefs: string[] };
export type AttributeGroup = { name: string; starIds: string[]; starRefs: string[] };

export type GraphViewModel = {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: {
    positions: number;
    stars: number;
    quantifiedResults: number;
    totalResults: number;
    skillsWithAts: number;
    totalSkills: number;
    /** Unique (deduped) competence/attribute node counts — for the "ATS skills" tile, which
     * treats Skills/Competences/Attributes as one family for CV-tailoring purposes even
     * though only Skill rows actually carry ATS keyword variants. */
    totalCompetences: number;
    totalAttributes: number;
  };
  // Lookup maps the side panel needs, keyed by DB id (not refCode) unless noted.
  byId: Map<string, GraphNode>;
  starsByPositionId: Map<string, CareerGraph['stars']>;
  respByPositionId: Map<string, CareerGraph['responsibilities']>;
  actionsByStarId: Map<string, CareerGraph['actions']>;
  resultsByStarId: Map<string, CareerGraph['results']>;
  competencesByStarId: Map<string, CompetenceGroup[]>;
  attributesByStarId: Map<string, AttributeGroup[]>;
  skillsByStarId: Map<string, CareerGraph['skills']>;
  /** Reverse of skillsByStarId — every STAR a given skill's evidence resolves to, after
   * parsing free-text shorthand ("STAR 4", "All STARs", "All senior STARs"). Built once
   * here so the side panel doesn't have to re-derive it from raw `starEvidence` text. */
  starsBySkillId: Map<string, CareerGraph['stars']>;
  positionById: Map<string, CareerGraph['positions'][number]>;
  starById: Map<string, CareerGraph['stars'][number]>;
};

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

// Ref-code join key normalization. `stars.positionRef`, `starActions.starRef`,
// `starResults.starRef`, `responsibilities.positionRef`, `starCompetences.starRef`,
// `starAttributes.starRef` and `skillsMaster.starEvidence` all join to a parent's
// `refCode` by raw string equality — but these are free-text columns, hand-entered
// or imported from the workbook, so a stray leading/trailing space or a case slip
// ("f-r2" vs "F-R2") silently drops the link (the old code's `.get(ref)` just
// returned undefined, no error) even though the evidence is really there. Every
// refCode-keyed map below is built and read through this same normalizer so a
// formatting difference can't produce a phantom orphan node.
export const normRef = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

// `skillsMaster.starEvidence` wasn't entered as clean ref codes — it was typed as
// human-readable shorthand ("STAR 4", "STARs 1, 2, 5, 7" split into ["STARs 1", "2", "5",
// "7"] by the list parser, "All STARs", "All senior STARs"). `normRef` alone can't resolve
// any of that: the mismatch isn't casing/whitespace, it's an extra word. Confirmed against
// real data via `scripts/diagnose-career-graph-orphans.ts` — normalization recovered zero
// rows; every failure was this shorthand.
//
// "Senior" has no field anywhere in the schema (positions don't record seniority live), so
// rather than guess, the set of "senior" positions below is an explicit, user-confirmed
// list — not an inference. If it ever needs to change, change this list; don't try to
// derive "senior" from title text.
const SENIOR_POSITION_TITLES = new Set(
  ['Head of Governance and Strategy', 'Deputy Head of Controlling & IT', 'Senior Analyst to the Board', 'Trade Marketing Coordinator'].map(norm)
);

/** Which STAR refCodes count as "senior" for the "All senior STARs" shorthand — see the
 * comment on SENIOR_POSITION_TITLES above. Exported alongside `resolveStarEvidenceRef` so
 * a data-cleanup script can compute the exact same set the graph does. */
export function seniorStarRefCodesOf(stars: CareerGraph['stars'], positions: CareerGraph['positions']): string[] {
  const posByRefCode = new Map(positions.filter((p) => p.refCode).map((p) => [normRef(p.refCode), p]));
  return stars
    .filter((st) => {
      const p = st.positionRef ? posByRefCode.get(normRef(st.positionRef)) : undefined;
      return !!p?.title && SENIOR_POSITION_TITLES.has(norm(p.title));
    })
    .map((st) => st.refCode)
    .filter((r): r is string => !!r);
}

/** Resolve one raw `skillsMaster.starEvidence` entry — free text, not a clean ref code, e.g.
 * `"STAR 4"`, `"All STARs"` — into the STAR refCode(s) it actually means. Exported so
 * `scripts/normalize-skill-star-evidence.ts` shares this exact rule instead of
 * reimplementing it; the graph and the cleanup script must never disagree on what a given
 * piece of shorthand resolves to. */
export function resolveStarEvidenceRef(raw: string, allStarRefCodes: string[], seniorStarRefCodes: string[]): string[] {
  const s = raw.trim();
  if (/^all\s+senior\s+stars?$/i.test(s)) return seniorStarRefCodes;
  if (/^all\s+stars?$/i.test(s)) return allStarRefCodes;
  const m = s.match(/^stars?\s+(.+)$/i); // strip a leading "STAR"/"STARs" word, e.g. "STAR 4" → "4"
  return [m ? m[1] : s];
}

export function buildGraphViewModel(g: CareerGraph): GraphViewModel {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  const posByRefCode = new Map(g.positions.filter((p) => p.refCode).map((p) => [normRef(p.refCode), p]));
  const starByRefCode = new Map(g.stars.filter((s) => s.refCode).map((s) => [normRef(s.refCode), s]));
  const positionById = new Map(g.positions.map((p) => [p.id, p]));
  const starById = new Map(g.stars.map((s) => [s.id, s]));

  // Chronological-ish order (oldest first) — best-effort parse since startDate is free text.
  const dateKey = (s: string | null) => {
    if (!s) return 0;
    const m = s.match(/(\d{4})/);
    return m ? Number(m[1]) : 0;
  };
  const posOrder = [...g.positions].sort((a, b) => dateKey(a.startDate) - dateKey(b.startDate));

  for (const p of posOrder) {
    nodes.push({ id: `pos-${p.id}`, type: 'position', label: p.title ?? p.refCode ?? 'Position', sub: p.company ?? undefined, data: p });
  }
  for (const s of g.stars) {
    const p = s.positionRef ? posByRefCode.get(normRef(s.positionRef)) : undefined;
    nodes.push({ id: `star-${s.id}`, type: 'star', label: s.title ?? s.refCode ?? 'STAR', data: s });
    if (p) links.push({ source: `pos-${p.id}`, target: `star-${s.id}`, kind: 'contains' });
  }
  for (const a of g.actions) {
    const s = a.starRef ? starByRefCode.get(normRef(a.starRef)) : undefined;
    if (!s) continue;
    nodes.push({ id: `act-${a.id}`, type: 'action', label: a.text ?? 'Action', data: a });
    links.push({ source: `star-${s.id}`, target: `act-${a.id}`, kind: 'contains' });
  }
  for (const r of g.results) {
    const s = r.starRef ? starByRefCode.get(normRef(r.starRef)) : undefined;
    if (!s) continue;
    nodes.push({ id: `res-${r.id}`, type: 'result', label: r.text ?? 'Result', data: r });
    links.push({ source: `star-${s.id}`, target: `res-${r.id}`, kind: 'contains' });
  }
  for (const r of g.responsibilities) {
    const p = r.positionRef ? posByRefCode.get(normRef(r.positionRef)) : undefined;
    nodes.push({ id: `resp-${r.id}`, type: 'responsibility', label: r.text ?? 'Responsibility', data: r });
    if (p) links.push({ source: `pos-${p.id}`, target: `resp-${r.id}`, kind: 'contains' });
  }

  // Competences/attributes: dedupe by name, one node per unique name, linked to every
  // STAR that demonstrates it.
  function dedupeGroups<T extends { starRef: string | null }>(rows: T[], nameOf: (r: T) => string | null) {
    const map = new Map<string, { name: string; starRefs: Set<string> }>();
    for (const row of rows) {
      const name = nameOf(row);
      if (!name || !name.trim()) continue;
      const key = norm(name);
      if (!map.has(key)) map.set(key, { name: name.trim(), starRefs: new Set() });
      if (row.starRef) map.get(key)!.starRefs.add(normRef(row.starRef));
    }
    return [...map.values()];
  }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');

  const competencesByStarId = new Map<string, CompetenceGroup[]>();
  for (const grp of dedupeGroups(g.competences, (c) => c.competence)) {
    const starIds = [...grp.starRefs].map((ref) => starByRefCode.get(ref)?.id).filter((id): id is string => !!id);
    if (!starIds.length) continue;
    const id = `comp-${slug(grp.name)}`;
    nodes.push({ id, type: 'competence', label: grp.name, data: { name: grp.name, starIds } });
    for (const sid of starIds) {
      links.push({ source: `star-${sid}`, target: id, kind: 'contains' });
      if (!competencesByStarId.has(sid)) competencesByStarId.set(sid, []);
      competencesByStarId.get(sid)!.push({ name: grp.name, starIds, starRefs: [...grp.starRefs] });
    }
  }

  const attributesByStarId = new Map<string, AttributeGroup[]>();
  for (const grp of dedupeGroups(g.attributes, (a) => a.attribute)) {
    const starIds = [...grp.starRefs].map((ref) => starByRefCode.get(ref)?.id).filter((id): id is string => !!id);
    if (!starIds.length) continue;
    const id = `attr-${slug(grp.name)}`;
    nodes.push({ id, type: 'attribute', label: grp.name, data: { name: grp.name, starIds } });
    for (const sid of starIds) {
      links.push({ source: `star-${sid}`, target: id, kind: 'contains' });
      if (!attributesByStarId.has(sid)) attributesByStarId.set(sid, []);
      attributesByStarId.get(sid)!.push({ name: grp.name, starIds, starRefs: [...grp.starRefs] });
    }
  }

  const allStarRefCodes = g.stars.map((st) => st.refCode).filter((r): r is string => !!r);
  const seniorStarRefCodes = seniorStarRefCodesOf(g.stars, g.positions);

  const skillsByStarId = new Map<string, CareerGraph['skills']>();
  const starsBySkillId = new Map<string, CareerGraph['stars']>();
  for (const sk of g.skills) {
    nodes.push({ id: `skill-${sk.id}`, type: 'skill', label: sk.skill ?? 'Skill', data: sk });
    const linkedStarIds = new Set<string>();
    for (const rawRef of sk.starEvidence ?? []) {
      for (const ref of resolveStarEvidenceRef(rawRef, allStarRefCodes, seniorStarRefCodes)) {
        const s = starByRefCode.get(normRef(ref));
        if (!s || linkedStarIds.has(s.id)) continue;
        linkedStarIds.add(s.id);
        links.push({ source: `star-${s.id}`, target: `skill-${sk.id}`, kind: 'evidence' });
        if (!skillsByStarId.has(s.id)) skillsByStarId.set(s.id, []);
        skillsByStarId.get(s.id)!.push(sk);
        if (!starsBySkillId.has(sk.id)) starsBySkillId.set(sk.id, []);
        starsBySkillId.get(sk.id)!.push(s);
      }
    }
  }

  // Bullets — overlay layer, hidden by default. Position link only when `cvPosition`
  // text-matches a position title (best-effort, not a stored FK). Skill link only when
  // a bullet tag exactly matches a skill name — an inference from the bracketed C3 tag,
  // not a stored source reference.
  const posByTitle = new Map(g.positions.filter((p) => p.title).map((p) => [norm(p.title), p]));
  const skillByName = new Map(g.skills.filter((s) => s.skill).map((s) => [norm(s.skill), s]));
  for (const b of g.bullets) {
    const id = `bullet-${b.id}`;
    nodes.push({ id, type: 'bullet', label: b.text ?? 'CV bullet', data: b });
    const matchedPos = b.cvPosition ? posByTitle.get(norm(b.cvPosition)) : undefined;
    if (matchedPos) links.push({ source: `pos-${matchedPos.id}`, target: id, kind: 'bullet-slot' });
    const seenSkills = new Set<string>();
    for (const tag of b.tags ?? []) {
      const sk = skillByName.get(norm(tag));
      if (sk && !seenSkills.has(sk.id)) {
        seenSkills.add(sk.id);
        links.push({ source: id, target: `skill-${sk.id}`, kind: 'bullet-tag' });
      }
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));

  const starsByPositionId = new Map<string, CareerGraph['stars']>();
  for (const s of g.stars) {
    const p = s.positionRef ? posByRefCode.get(normRef(s.positionRef)) : undefined;
    if (!p) continue;
    if (!starsByPositionId.has(p.id)) starsByPositionId.set(p.id, []);
    starsByPositionId.get(p.id)!.push(s);
  }
  const respByPositionId = new Map<string, CareerGraph['responsibilities']>();
  for (const r of g.responsibilities) {
    const p = r.positionRef ? posByRefCode.get(normRef(r.positionRef)) : undefined;
    if (!p) continue;
    if (!respByPositionId.has(p.id)) respByPositionId.set(p.id, []);
    respByPositionId.get(p.id)!.push(r);
  }
  const actionsByStarId = new Map<string, CareerGraph['actions']>();
  for (const a of g.actions) {
    const s = a.starRef ? starByRefCode.get(normRef(a.starRef)) : undefined;
    if (!s) continue;
    if (!actionsByStarId.has(s.id)) actionsByStarId.set(s.id, []);
    actionsByStarId.get(s.id)!.push(a);
  }
  const resultsByStarId = new Map<string, CareerGraph['results']>();
  for (const r of g.results) {
    const s = r.starRef ? starByRefCode.get(normRef(r.starRef)) : undefined;
    if (!s) continue;
    if (!resultsByStarId.has(s.id)) resultsByStarId.set(s.id, []);
    resultsByStarId.get(s.id)!.push(r);
  }

  const totalResults = g.results.length;
  const quantifiedResults = g.results.filter((r) => r.metric && String(r.metric).trim()).length;
  const skillsWithAts = g.skills.filter((s) => (s.atsKeywordVariants ?? []).length > 0).length;
  // Unique node counts, not raw row counts — matches what the graph actually renders
  // (a competence/attribute repeated across STARs under the same name is one node).
  const totalCompetences = nodes.filter((n) => n.type === 'competence').length;
  const totalAttributes = nodes.filter((n) => n.type === 'attribute').length;

  return {
    nodes,
    links,
    stats: {
      positions: g.positions.length,
      stars: g.stars.length,
      quantifiedResults,
      totalResults,
      skillsWithAts,
      totalSkills: g.skills.length,
      totalCompetences,
      totalAttributes,
    },
    byId,
    starsByPositionId,
    respByPositionId,
    actionsByStarId,
    resultsByStarId,
    competencesByStarId,
    attributesByStarId,
    skillsByStarId,
    starsBySkillId,
    positionById,
    starById,
  };
}

export const GRAPH_FOOTNOTE =
  "Hierarchy: Position→STAR, STAR→Action, STAR→Result and Position→Responsibility (all one-to-many). Competences, attributes and skills are recorded at the STAR level — not tied to one specific action or result — so a competence or attribute that recurs under the same name across stories (e.g. “Innovativeness” on three STARs) is collapsed into one node with a link to each story, the same pattern skills already use via their star evidence list. CV Bullets (hidden until toggled in the legend) link to a position only when their CV-slot text matches a position title, and to a skill only when one of the bullet's tags exactly matches a skill name — both best-effort text matches, not stored references, since this profile's data doesn't yet record a bullet's specific source evidence. Layout is force-directed and settles on load — drag any node to rearrange, scroll to zoom.";
