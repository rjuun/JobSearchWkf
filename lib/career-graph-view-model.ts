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
 * workbook, which carries richer columns than the live schema — separate Situation/Task
 * text and position seniority/location. Those aren't modeled live and are omitted rather
 * than invented. Bullet source citations, however, ARE real live data now: `bullet_evidence`
 * (CI · *Real Bullet Evidence Provenance*, 2026-08-08) records which exact evidence row(s)
 * a bullet was actually written from, one row per (bullet, evidence) pair — a bullet can
 * genuinely merge several. A bullet with at least one confirmed row draws a dashed line to
 * each of those exact nodes (kind `bullet-evidence`). A bullet with none yet falls back to
 * CI-040's slot-level inference: `cvPosition` holds a `CV_SLOTS` slot code (`lib/cv-slots.ts`),
 * not a position title, so a project-slot bullet (A1, B2, ...) links to its specific STAR via
 * a hardcoded, human-confirmed slot→STAR mapping (`CV_SLOT_STAR_REF`), and a role-overview
 * bullet (A0, B0, ...) links to every Responsibility under that slot letter's position — a
 * rollup, not a single-project link (kind `bullet-slot`, visually weaker). A bullet also links
 * to a skill when one of its `tags` exactly matches a skill name (kind `bullet-tag`) — always
 * an inference, never a stored source, regardless of which of the above applies. All three are
 * called out in `GRAPH_FOOTNOTE` below so the UI stays honest about which is which. See
 * `[[Fix CV Bullet Evidence Linking in the Career Graph]]` (2026-08-06) and
 * `[[Real Bullet Evidence Provenance in the Career Graph]]` (2026-08-08).
 */
import type { CareerGraph } from './career-graph';
import { normalizeCvPosition, slotCode } from './cv-slots';

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

export type LinkKind = 'contains' | 'evidence' | 'bullet-slot' | 'bullet-tag' | 'bullet-evidence';

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
  /** A project-slot bullet's (A1, B2, ...) resolved STAR, keyed by bullet id — the
   * CV_SLOT_STAR_REF fallback, only populated for a bullet with NO confirmed
   * `bullet_evidence` row. Built once here, alongside the `bullet-slot` link itself, so the
   * side panel reads the same resolution the graph draws instead of re-deriving it (and
   * drifting) from `cvPosition` text a second time. */
  starByBulletId: Map<string, CareerGraph['stars'][number]>;
  /** A role-overview bullet's (A0, B0, ...) resolved Responsibilities, keyed by bullet id —
   * same fallback-only, one-parsing-path rationale as starByBulletId above. */
  respByBulletId: Map<string, CareerGraph['responsibilities']>;
  /** CI · Real Bullet Evidence Provenance — a bullet's CONFIRMED evidence nodes (from
   * `bullet_evidence`), keyed by bullet id. Populated instead of starByBulletId/
   * respByBulletId whenever a bullet has at least one confirmed row; a bullet can resolve
   * to several nodes (a genuine multi-source merge, e.g. `C1`). Absent (not just empty)
   * for a bullet with no confirmed source — "no confirmed source" is a distinct, more
   * honest state than "confirmed empty". */
  evidenceNodesByBulletId: Map<string, GraphNode[]>;
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

// Confirmed against the live `stars` table on 2026-08-06 — see [[Fix CV Bullet Evidence
// Linking in the Career Graph]]. Hardcoded rather than fuzzy-matched at render time:
// CV_SLOTS (lib/cv-slots.ts) is already a small, profile-specific, hardcoded list, so its
// mapping to real STARs should be too. (A keyword matcher would misfire on cases like
// A2 below — "Governance Transformation Project" vs. a STAR titled "Transforming
// Governance Process" shares only one exact token.)
const CV_SLOT_STAR_REF: Record<string, string> = {
  A1: '5', // Outsourcing Framework Development and Rollout
  A2: '6', // Transforming Governance Process
  A3: '7', // Wind Down of BBAG
  B1: '3', // Construction of Accounting Correction Layer and Controlling Dashboards
  B2: '4', // Transfer Pricing — Master File Implementation
  C1: '2', // Merger of BBSA Branches with its European Subsidiary (BBAG)
  D1: '1', // Establishment of a Servicing Center in Portugal
};

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
  // Ref-code → node-id maps, built alongside node creation below rather than re-derived
  // later, so a bullet_evidence row (CI · Real Bullet Evidence Provenance) resolves to
  // exactly the node the graph actually drew — never a phantom id for a row that was
  // skipped (no matching STAR/position).
  const actionNodeIdByRefCode = new Map<string, string>();
  const resultNodeIdByRefCode = new Map<string, string>();
  const respNodeIdByRefCode = new Map<string, string>();

  for (const a of g.actions) {
    const s = a.starRef ? starByRefCode.get(normRef(a.starRef)) : undefined;
    if (!s) continue;
    const id = `act-${a.id}`;
    nodes.push({ id, type: 'action', label: a.text ?? 'Action', data: a });
    links.push({ source: `star-${s.id}`, target: id, kind: 'contains' });
    if (a.refCode) actionNodeIdByRefCode.set(normRef(a.refCode), id);
  }
  for (const r of g.results) {
    const s = r.starRef ? starByRefCode.get(normRef(r.starRef)) : undefined;
    if (!s) continue;
    const id = `res-${r.id}`;
    nodes.push({ id, type: 'result', label: r.text ?? 'Result', data: r });
    links.push({ source: `star-${s.id}`, target: id, kind: 'contains' });
    if (r.refCode) resultNodeIdByRefCode.set(normRef(r.refCode), id);
  }
  for (const r of g.responsibilities) {
    const p = r.positionRef ? posByRefCode.get(normRef(r.positionRef)) : undefined;
    const id = `resp-${r.id}`;
    nodes.push({ id, type: 'responsibility', label: r.text ?? 'Responsibility', data: r });
    if (p) links.push({ source: `pos-${p.id}`, target: id, kind: 'contains' });
    if (r.refCode) respNodeIdByRefCode.set(normRef(r.refCode), id);
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

  // A competence/attribute row's own ref_code → the (deduped, per-name) node id it landed
  // on, for bullet_evidence resolution. Only set when the row's group actually got a node
  // (i.e. resolved to at least one real STAR) — a row whose group was dropped has no node
  // to point to, same as any other unresolved evidence ref.
  const createdCompetenceIds = new Set(nodes.filter((n) => n.type === 'competence').map((n) => n.id));
  const competenceNodeIdByRefCode = new Map<string, string>();
  for (const c of g.competences) {
    if (!c.refCode || !c.competence) continue;
    const nid = `comp-${slug(c.competence)}`;
    if (createdCompetenceIds.has(nid)) competenceNodeIdByRefCode.set(normRef(c.refCode), nid);
  }
  const createdAttributeIds = new Set(nodes.filter((n) => n.type === 'attribute').map((n) => n.id));
  const attributeNodeIdByRefCode = new Map<string, string>();
  for (const a of g.attributes) {
    if (!a.refCode || !a.attribute) continue;
    const nid = `attr-${slug(a.attribute)}`;
    if (createdAttributeIds.has(nid)) attributeNodeIdByRefCode.set(normRef(a.refCode), nid);
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

  // respByPositionId is built here (ahead of the bullets loop below, unlike the other
  // by-id lookup maps further down) because role-overview bullets need it.
  const respByPositionId = new Map<string, CareerGraph['responsibilities']>();
  for (const r of g.responsibilities) {
    const p = r.positionRef ? posByRefCode.get(normRef(r.positionRef)) : undefined;
    if (!p) continue;
    if (!respByPositionId.has(p.id)) respByPositionId.set(p.id, []);
    respByPositionId.get(p.id)!.push(r);
  }

  // A/B/C/D → position id, derived from each letter's resolved project STAR's own
  // `positionRef` (never the bullet's own ref-code prefix letter, and never assumed
  // from CV_SLOTS' letter matching a position's own refCode — coincidental in this
  // profile's data, not a rule). If a letter's own slots ever disagreed on position,
  // that's a real data problem worth surfacing loudly, not silently picking one.
  const CV_SLOT_LETTER_POSITION = new Map<string, string>();
  for (const [code, starRef] of Object.entries(CV_SLOT_STAR_REF)) {
    const s = starByRefCode.get(normRef(starRef));
    const p = s?.positionRef ? posByRefCode.get(normRef(s.positionRef)) : undefined;
    if (!p) continue;
    const letter = code[0];
    const existing = CV_SLOT_LETTER_POSITION.get(letter);
    if (existing && existing !== p.id) {
      throw new Error(
        `Career Graph: CV slot letter "${letter}" resolves to two different positions via its STARs ` +
          `(${existing} vs ${p.id}) — check CV_SLOT_STAR_REF in lib/career-graph-view-model.ts.`
      );
    }
    CV_SLOT_LETTER_POSITION.set(letter, p.id);
  }

  // A bullet_evidence row's (evidenceTable, evidenceKey) → the exact node it names, using
  // the same ref-code join convention as every other edge in this graph. Returns undefined
  // for a dangling/unrecognized ref — callers must not fall back to the CV_SLOT_STAR_REF
  // guess in that case (a confirmed-but-broken ref is a data bug to surface, not paper over).
  function resolveEvidenceNodeId(evidenceTable: string | null, evidenceKey: string | null): string | undefined {
    if (!evidenceKey) return undefined;
    const key = normRef(evidenceKey);
    switch (evidenceTable) {
      case 'stars': {
        const s = starByRefCode.get(key);
        return s ? `star-${s.id}` : undefined;
      }
      case 'star_actions':
        return actionNodeIdByRefCode.get(key);
      case 'star_results':
        return resultNodeIdByRefCode.get(key);
      case 'responsibilities':
        return respNodeIdByRefCode.get(key);
      case 'star_competences':
        return competenceNodeIdByRefCode.get(key);
      case 'star_attributes':
        return attributeNodeIdByRefCode.get(key);
      case 'skills_master': {
        const sk = skillByRefCode.get(key);
        return sk ? `skill-${sk.id}` : undefined;
      }
      default:
        return undefined;
    }
  }

  // Bullets — overlay layer, hidden by default. `cvPosition` holds a CV_SLOTS slot code
  // (never a position title) and answers WHERE a bullet renders — separate from WHAT it
  // was built from. A bullet with one or more confirmed `bullet_evidence` rows (CI · Real
  // Bullet Evidence Provenance) draws a dashed line to each exact evidence row it names —
  // real, per-bullet provenance, possibly more than one (a bullet can genuinely merge
  // several evidence rows into one narrative line). A bullet with NO confirmed row yet
  // falls back to CI-040's slot-level inference (CV_SLOT_STAR_REF / role-overview
  // Responsibilities rollup) so it still draws *something* rather than floating as an
  // orphan — a weaker, visually distinct link kind, since it's a slot guess, not a stored
  // source. Skill link only when a bullet tag exactly matches a skill name — an inference
  // from the bracketed C3 tag, not a stored source reference either.
  const skillByRefCode = new Map(g.skills.filter((s) => s.refCode).map((s) => [normRef(s.refCode), s]));
  const skillByName = new Map(g.skills.filter((s) => s.skill).map((s) => [norm(s.skill), s]));
  const evidenceByBulletId = new Map<string, CareerGraph['bulletEvidence']>();
  for (const be of g.bulletEvidence) {
    if (!evidenceByBulletId.has(be.bulletId)) evidenceByBulletId.set(be.bulletId, []);
    evidenceByBulletId.get(be.bulletId)!.push(be);
  }
  const starByBulletId = new Map<string, CareerGraph['stars'][number]>();
  const respByBulletId = new Map<string, CareerGraph['responsibilities']>();
  const evidenceNodeIdsByBulletId = new Map<string, string[]>();
  for (const b of g.bullets) {
    const id = `bullet-${b.id}`;
    nodes.push({ id, type: 'bullet', label: b.text ?? 'CV bullet', data: b });

    const confirmed = evidenceByBulletId.get(b.id) ?? [];
    if (confirmed.length > 0) {
      const resolvedIds: string[] = [];
      for (const be of confirmed) {
        const nodeId = resolveEvidenceNodeId(be.evidenceTable, be.evidenceKey);
        if (!nodeId) continue;
        resolvedIds.push(nodeId);
        links.push({ source: nodeId, target: id, kind: 'bullet-evidence' });
      }
      if (resolvedIds.length) evidenceNodeIdsByBulletId.set(b.id, resolvedIds);
    } else {
      const fullSlot = b.cvPosition ? normalizeCvPosition(b.cvPosition) : null;
      const code = fullSlot ? slotCode(fullSlot) : null;
      if (code) {
        const starRef = CV_SLOT_STAR_REF[code];
        if (starRef) {
          const s = starByRefCode.get(normRef(starRef));
          if (s) {
            links.push({ source: `star-${s.id}`, target: id, kind: 'bullet-slot' });
            starByBulletId.set(b.id, s);
          }
        } else {
          const posId = CV_SLOT_LETTER_POSITION.get(code[0]);
          const resps = posId ? respByPositionId.get(posId) ?? [] : [];
          if (resps.length) respByBulletId.set(b.id, resps);
          for (const r of resps) links.push({ source: `resp-${r.id}`, target: id, kind: 'bullet-slot' });
        }
      }
    }

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

  const evidenceNodesByBulletId = new Map<string, GraphNode[]>();
  for (const [bulletId, nodeIds] of evidenceNodeIdsByBulletId) {
    const resolved = nodeIds.map((nid) => byId.get(nid)).filter((n): n is GraphNode => !!n);
    if (resolved.length) evidenceNodesByBulletId.set(bulletId, resolved);
  }

  const starsByPositionId = new Map<string, CareerGraph['stars']>();
  for (const s of g.stars) {
    const p = s.positionRef ? posByRefCode.get(normRef(s.positionRef)) : undefined;
    if (!p) continue;
    if (!starsByPositionId.has(p.id)) starsByPositionId.set(p.id, []);
    starsByPositionId.get(p.id)!.push(s);
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
    starByBulletId,
    respByBulletId,
    evidenceNodesByBulletId,
    positionById,
    starById,
  };
}

export const GRAPH_FOOTNOTE =
  "Hierarchy: Position→STAR, STAR→Action, STAR→Result and Position→Responsibility (all one-to-many). Competences, attributes and skills are recorded at the STAR level — not tied to one specific action or result — so a competence or attribute that recurs under the same name across stories (e.g. “Innovativeness” on three STARs) is collapsed into one node with a link to each story, the same pattern skills already use via their star evidence list. CV Bullets stay hidden until toggled in the legend — and once toggled on, the graph switches to bullets-only mode, showing just the bullets and their direct connections rather than dropping them onto the full hierarchy above. A visible bullet draws a solid line to the exact evidence row(s) it was confirmed as written from (CI · Real Bullet Evidence Provenance) — sometimes more than one, when a bullet genuinely merges several pieces of evidence into one narrative line. A bullet with no confirmed source yet falls back to a lighter, more faded line: its CV-slot code (not a position title) resolved via a hardcoded, human-confirmed slot→STAR mapping, or, for a role-overview bullet, a rollup of every Responsibility under that slot's position — an inference, not a stored source. A bullet also links to a skill when one of its tags exactly matches a skill name, always an inference. Layout is force-directed and settles on load — drag any node to rearrange, scroll to zoom.";
