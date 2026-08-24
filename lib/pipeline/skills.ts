/**
 * C2/C4 skills vocabulary — the two pure decisions this CI exists to correct.
 *
 * CI · C4 Skills Selection Produces Unreadable Overflow. The
 * [[Requirement Skills vs My Skills — Two-Column Redesign (Epic)]] §2 specified
 * My Skills as "the candidate's own vocabulary for the same evidence — drawn
 * from `skills_master`, and (pending Q3) `star_competences` /
 * `star_attributes`", and §5 flagged Q3 as the one open question to settle
 * *before* the C4 rewrite. Q3 was never answered and the build shipped
 * `mySkills: ev.skills` instead — the evidence node's own free-text tags, a
 * third option the design never listed. Measured on the live profile: 246
 * distinct tags across 104 evidence rows, 180 of them used exactly once, only
 * 8 present in any curated table. C4's uncapped consistency rule then printed
 * all of a Keep set's tags verbatim, which is where "67 skills in one line"
 * came from.
 *
 * Q3 is now answered — all three tables — and the two halves live here:
 *
 *  - `buildVocabIndex` / `resolveVocab`: nothing becomes a My Skills value
 *    unless it is a real name in the owner's curated vocabulary. Free-text
 *    graph tags stay on the graph as provenance and never reach the CV.
 *  - `prioritiseSkills` / `reconcileSkillGroups` / `ungroupedSkills`: C4 §A's
 *    three moves, in order. Collect every skill the Keep-gated bullets declare
 *    (`cv_bullet_skills`); prioritise Core → Important → Nice-to-Have until the
 *    section is full (§B.3); then group what survived into 3–5 capability areas
 *    (§B.1).
 *
 * The grouping half was wrong until 2026-08-24: it printed the rank names
 * themselves as headings — Core Competencies / Supporting Expertise /
 * Additional Skills — which implements §B.3 and leaves §B.1 unbuilt. The owner:
 * *"the procedure was always about creating meaningful skill groups (3 to 5) to
 * facilitate the vertical reading… which is not what I want."* Prioritisation
 * decides WHICH skills print; categorisation decides what they print UNDER.
 * They are different questions and the old code answered only one of them.
 *
 * Pure on purpose: `lib/pipeline/tailoring.ts` is a DB/LLM module that cannot
 * be imported under vitest, and this is the part worth testing directly.
 */

/** One name the owner's profile actually recognises, from any of the three
 *  curated tables (epic Q3 — all three count as "Skills" on a CV, even though
 *  the profile tables distinguish them). */
export type VocabEntry = {
  name: string;
  source: 'skill' | 'competence' | 'attribute';
  /** Only `skills_master` carries one; competences and attributes have none. */
  proficiency: string | null;
  /** `skills_master.ats_keyword_variants` — the alternate wordings this skill is
   *  known by. Exists precisely so a differently-worded tag can be recognised. */
  variants: string[];
};

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Exact-match index over every name the profile recognises, plus every ATS
 * variant of it. Exact only — no token overlap, no fuzzy scoring. A near-miss
 * that silently resolves to the wrong skill is worse on a CV than a tag that
 * doesn't resolve at all: it is a claim the candidate never made. (Measured
 * during this CI: token-subsumption matching mapped the bare tag "Leadership"
 * onto "Change Management", via that skill's "change leadership" variant.)
 *
 * First writer wins, and `skills_master` is loaded first by the caller, so a
 * name carried by both a skill and a competence resolves to the skill — the
 * only source with a proficiency and ATS variants attached.
 */
export function buildVocabIndex(entries: readonly VocabEntry[]): Map<string, VocabEntry> {
  const index = new Map<string, VocabEntry>();
  for (const e of entries) {
    if (!e.name?.trim()) continue;
    for (const key of [e.name, ...e.variants]) {
      const k = norm(key ?? '');
      if (k && !index.has(k)) index.set(k, e);
    }
  }
  return index;
}

/**
 * Canonicalise raw names against the vocabulary, returning the profile's own
 * spelling and dropping anything it doesn't recognise. Order-preserving and
 * deduplicated, so two variants of one skill collapse to a single entry.
 *
 * Dropping is the point: an unrecognised name is either free-text graph
 * vocabulary (provenance, not a CV skill) or a model invention. Neither has a
 * claim on a line of the CV.
 */
export function resolveVocab(raw: readonly string[], index: Map<string, VocabEntry>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of raw ?? []) {
    const hit = index.get(norm(name ?? ''));
    if (!hit) continue;
    const key = norm(hit.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit.name);
  }
  return out;
}

/** A Keep-gated `requirement_tailoring` row, reduced to what C4 needs. */
export type KeepRowSkills = {
  /** The matched requirement's B2 rank: Core | Important | Nice-to-Have. */
  rank: string | null;
  /** `requirement_tailoring.cv_bullet_skills` — what C3's tailored bullet
   *  actually displays. Not `requirement_skills`, which is what the JD asked
   *  for and may be broader than the bullet ended up evidencing. */
  cvBulletSkills: readonly string[] | null;
};

/**
 * How many skills the section can hold: C4 §B.1's own envelope, 3–5 categories
 * × 4–8 skills. §A's prioritisation exists precisely to fit within it — "as the
 * number of declared skills allows", in the owner's words — so this is the
 * number that decides what gets shed, not a safety cap bolted on afterwards.
 */
export const SKILLS_ENVELOPE = 40;

/** Rank order for §B.3's prioritisation: Core first, then Important, then
 *  Nice-to-Have, then anything whose requirement carries no recognised rank. */
const RANK_ORDER = ['core', 'important', 'nice-to-have'];

/**
 * §A step 1–2: collect every skill the Keep-gated bullets declare, in priority
 * order, cut to what the section can hold.
 *
 * A skill claimed by several ranks keeps its BEST rank — it is one skill, and
 * the highest-ranked requirement it answers is what decides whether it survives
 * the cut. Order within a rank follows row order, so a re-run of the same data
 * produces the same list.
 *
 * Note what this does NOT do any more: it does not group. Rank decides *which*
 * skills print and in what priority; it says nothing about the headings they
 * print under. Conflating the two is the mistake this function was split out of
 * — see `buildSkillsSection`.
 */
export function prioritiseSkills(rows: readonly KeepRowSkills[], limit = SKILLS_ENVELOPE): string[] {
  const out: string[] = [];
  const claimed = new Set<string>();
  const take = (row: KeepRowSkills) => {
    for (const raw of row.cvBulletSkills ?? []) {
      const name = (raw ?? '').trim();
      if (!name) continue;
      const key = norm(name);
      if (claimed.has(key)) continue;
      claimed.add(key);
      out.push(name);
    }
  };
  for (const rank of RANK_ORDER) {
    for (const row of rows) if (norm(row.rank ?? '') === rank) take(row);
  }
  // A row whose requirement carries no recognised rank still has Keep-gated
  // evidence behind it, so its skills are not discarded — they queue last, and
  // are therefore the first to fall off the cut.
  for (const row of rows) if (!RANK_ORDER.includes(norm(row.rank ?? ''))) take(row);
  return out.slice(0, Math.max(0, limit));
}

/**
 * Skills that are really a language — the CV has a Languages section of its own,
 * filled straight from the `languages` table, so printing "Business-Fluent
 * English" under Skills states the same fact twice in two different shapes and
 * spends a Skills slot on it. C4 §B.4: languages are never Skills entries.
 *
 * Matched against the owner's OWN language list rather than a hard-coded set of
 * language names — the profile already knows which languages exist, and a static
 * list would be one more thing to keep in sync. Word-boundary matching, so
 * "English" catches "Business-Fluent English" and "Fluency in English and
 * German" without catching a substring inside an unrelated word.
 *
 * Deliberately narrow: it drops an entry only when a language name is IN it. A
 * skill that merely relates to communication survives; the rule is about the
 * Languages section owning language facts, not about suppressing soft skills.
 */
export function dropLanguageSkills(selected: readonly string[], languageNames: readonly string[]): string[] {
  const names = languageNames.map((l) => (l ?? '').trim().toLowerCase()).filter(Boolean);
  if (names.length === 0) return [...selected];
  const patterns = names.map((n) => new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i'));
  return selected.filter((skill) => !patterns.some((re) => re.test(skill)));
}

export type SkillGroup = { category: string; items: string[] };

/** C4 §B.1: "Group skills into 3–5 high-level categories." */
const MAX_CATEGORIES = 5;
/** Where skills land that the grouping step failed to place. Should be empty in
 *  a healthy run — the step report surfaces the count so it is visible if not. */
const LEFTOVER_CATEGORY = 'Additional Skills';

/**
 * §A step 3: turn the grouping step's proposal into the section that prints.
 *
 * The categories themselves are a judgement — "the main capability areas
 * relevant to the Job Lead" (§B.1) — made per lead over this lead's actual set,
 * which is why a model proposes them. **What it proposes is not trusted.** A
 * model that reworded, invented, dropped or duplicated a skill would put text on
 * the CV that no bullet declares, which is the exact failure this CI exists to
 * end. So every returned name is checked back against the prioritised set:
 *
 *  - a name not in `selected` is dropped (invented or reworded)
 *  - the spelling that prints is `selected`'s, never the model's
 *  - a name claimed twice keeps its first placement
 *  - a name no category claimed is appended under `Additional Skills` rather
 *    than silently vanishing — losing a skill is worse than an ugly heading
 *  - beyond 5 categories, the surplus folds into the fifth (§B.1's ceiling)
 *
 * The result is that the model can only ever choose the ARRANGEMENT. The
 * content is decided in code, before it is asked.
 */
export function reconcileSkillGroups(
  selected: readonly string[],
  proposed: readonly { category: string; skills: readonly string[] }[]
): SkillGroup[] {
  const canonical = new Map<string, string>();
  for (const name of selected) {
    const key = norm(name);
    if (key && !canonical.has(key)) canonical.set(key, name);
  }

  const groups: SkillGroup[] = [];
  const placed = new Set<string>();
  for (const group of proposed) {
    const heading = (group.category ?? '').trim();
    if (!heading) continue;
    const items: string[] = [];
    for (const raw of group.skills ?? []) {
      const key = norm(raw ?? '');
      const name = canonical.get(key);
      if (!name || placed.has(key)) continue;
      placed.add(key);
      items.push(name);
    }
    if (items.length) groups.push({ category: heading, items });
  }

  // §B.1 caps at 5. Folding the surplus into the fifth keeps every skill while
  // respecting the ceiling; dropping the extra groups would drop their skills.
  if (groups.length > MAX_CATEGORIES) {
    const kept = groups.slice(0, MAX_CATEGORIES);
    for (const extra of groups.slice(MAX_CATEGORIES)) kept[MAX_CATEGORIES - 1].items.push(...extra.items);
    groups.length = 0;
    groups.push(...kept);
  }

  const leftover = selected.filter((name) => !placed.has(norm(name)));
  if (leftover.length) {
    const existing = groups.find((g) => g.category === LEFTOVER_CATEGORY);
    if (existing) existing.items.push(...leftover);
    else groups.push({ category: LEFTOVER_CATEGORY, items: leftover });
  }
  return groups;
}

/**
 * The deterministic fallback, used when the grouping call fails or is disabled
 * (mock mode with no key). One honest bucket beats a fabricated taxonomy: the
 * skills are still correct, still prioritised, and the reader can see they were
 * not grouped rather than being handed groups nobody stands behind.
 */
export function ungroupedSkills(selected: readonly string[]): SkillGroup[] {
  return selected.length ? [{ category: 'Core Competencies', items: [...selected] }] : [];
}
