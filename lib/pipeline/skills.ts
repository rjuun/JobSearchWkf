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
 *  - `buildSkillsSection`: the CV's Skills section is the `cv_bullet_skills`
 *    carried by Keep-gated rows only — i.e. the skills actually displayed by
 *    the tailored bullets, for requirements that have matched evidence —
 *    ordered Core → Important → Nice-to-Have per C4 §B.3. (CI · Split
 *    cv_bullet_skills from requirement_skills gave C3's tag its own column;
 *    this read `requirement_skills` until then.)
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

/** C4 §B.1's outer envelope (3–5 categories × 4–8 skills). Core and Important
 *  are never truncated — the owner asked for the whole list of skills carried
 *  by the tailored bullets — so this only ever sheds Nice-to-Have, which is
 *  exactly what §B.3 calls secondary. Inert on real data: the lead that
 *  produced the original 67 yields 16 here. */
export const SKILLS_ENVELOPE = 40;

/** Rank → the heading it prints under, in priority order (C4 §B.3 — Core and
 *  Important first, Nice-to-Have last). The headings are CV language, not the
 *  JD-internal rank labels; the thematic taxonomy a real CV shows
 *  ("Governance & Compliance", …) doesn't exist as data yet — ROADMAP P6. */
const RANK_HEADINGS: [rank: string, heading: string][] = [
  ['core', 'Core Competencies'],
  ['important', 'Supporting Expertise'],
  ['nice-to-have', 'Additional Skills'],
];

const ADDITIONAL = 'Additional Skills';

/**
 * Build the CV's Skills section from the Keep-gated rows.
 *
 * Source is `cv_bullet_skills`, not `my_skills` — the owner's decision on the
 * parent CI: the section prints "the whole list of skills associated with the
 * tailored cv_bullets, either bracketed or integrated", restricted to
 * requirements that actually have matched evidence. Keep-gated rows ARE that
 * restriction, and `cv_bullet_skills` is the only durable record of a bullet's
 * skills: bold-inline integration lives inside the bullet's own text and is
 * never captured separately, so both of C3 §B.5's presentation methods resolve
 * to this one column. (It read `requirement_skills` until C3's tag was split
 * into its own column — same values, but that column also held B2's asks
 * before C3 ran, so it could not say which it was carrying.)
 *
 * A skill claimed by several ranks prints once, under the highest — nothing is
 * duplicated across categories (C4 §D).
 */
export function buildSkillsSection(rows: readonly KeepRowSkills[]): { category: string; items: string[] }[] {
  const byRank = new Map<string, string[]>(RANK_HEADINGS.map(([rank]) => [rank, [] as string[]]));
  const unranked: string[] = [];
  const claimed = new Set<string>();

  const take = (into: string[], row: KeepRowSkills) => {
    for (const raw of row.cvBulletSkills ?? []) {
      const name = (raw ?? '').trim();
      if (!name) continue;
      const key = norm(name);
      if (claimed.has(key)) continue;
      claimed.add(key);
      into.push(name);
    }
  };

  // Iterate the rank order outside the rows, so a skill's category is decided
  // by its best rank rather than by whichever row happened to come first.
  for (const [rank] of RANK_HEADINGS) {
    for (const row of rows) if (norm(row.rank ?? '') === rank) take(byRank.get(rank)!, row);
  }
  // A row whose requirement carries no recognised rank still has real evidence
  // behind it, so its skills aren't discarded — they land last, with the other
  // secondary material.
  for (const row of rows) {
    if (byRank.has(norm(row.rank ?? ''))) continue;
    take(unranked, row);
  }

  const groups = RANK_HEADINGS.map(([rank, heading]) => ({ category: heading, items: byRank.get(rank)! }));
  if (unranked.length) {
    const additional = groups.find((g) => g.category === ADDITIONAL)!;
    additional.items = [...additional.items, ...unranked];
  }

  // Shed secondary material until inside the envelope — and ONLY secondary
  // material. Core and Important answer requirements with matched, Keep-gated
  // evidence behind them; dropping one to hit a number is dropping a proven
  // claim, which is the mistake the 24-item display cap made. If those two
  // alone overrun the envelope the section prints long, and that is a B2
  // over-extraction worth seeing rather than hiding.
  const additional = groups.find((g) => g.category === ADDITIONAL)!;
  const fixed = groups.reduce((n, g) => (g === additional ? n : n + g.items.length), 0);
  if (fixed + additional.items.length > SKILLS_ENVELOPE) {
    additional.items = additional.items.slice(0, Math.max(0, SKILLS_ENVELOPE - fixed));
  }

  return groups.filter((g) => g.items.length > 0);
}
