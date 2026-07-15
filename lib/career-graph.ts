/**
 * The Career Graph — the user's evidence store, and a deterministic measure of its strength.
 *
 * Per the build rule, code computes; nothing here calls the LLM. `strengthOf` turns the raw
 * evidence into a 0–100 strength score, named signals, and concrete gap hints — the basis for the
 * /profile "completeness meter" and (later, O3) the AI coaching targets.
 */
import type { InferSelectModel } from 'drizzle-orm';
import type {
  profiles,
  positions,
  stars,
  starActions,
  starResults,
  starCompetences,
  starAttributes,
  responsibilities,
  education,
  languages,
  bulletBank,
  skillsMaster,
} from './db/schema';

/**
 * Coverage of the requirements on the roles the user has flagged as targets. This is
 * the compounding lever (M1 / Phase 1C): flagging a role adds its Core/Important
 * requirements to what there is to prove, and covering them earns relevancy.
 */
export type TargetCoverage = {
  flaggedLeads: number; // how many leads flagged as targets
  requirements: number; // total Core/Important requirements across them
  covered: number; //      of those, how many the graph already evidences (not weak)
  open: number; //         the rest — still to prove (drives headroom + coach prompts)
};

export const EMPTY_TARGETS: TargetCoverage = { flaggedLeads: 0, requirements: 0, covered: 0, open: 0 };

export type CareerGraph = {
  profile: InferSelectModel<typeof profiles> | null;
  positions: InferSelectModel<typeof positions>[];
  stars: InferSelectModel<typeof stars>[];
  actions: InferSelectModel<typeof starActions>[];
  results: InferSelectModel<typeof starResults>[];
  competences: InferSelectModel<typeof starCompetences>[];
  attributes: InferSelectModel<typeof starAttributes>[];
  responsibilities: InferSelectModel<typeof responsibilities>[];
  education: InferSelectModel<typeof education>[];
  languages: InferSelectModel<typeof languages>[];
  bullets: InferSelectModel<typeof bulletBank>[];
  skills: InferSelectModel<typeof skillsMaster>[];
  /** Flagged-target requirement coverage (defaults to none when not loaded). */
  targets: TargetCoverage;
};

export type GraphSignals = {
  positions: number;
  stars: number;
  actions: number;
  results: number;
  quantifiedResults: number;
  competences: number;
  attributes: number;
  responsibilities: number;
  skills: number;
  skillsWithAts: number;
  education: number;
  languages: number;
  bullets: number;
  /** stories that have at least one quantified (metric-bearing) result */
  storiesWithImpact: number;
};

/** One weighted dimension of the strength meter, for the UI breakdown. */
export type StrengthComponent = {
  key: 'foundation' | 'quantified' | 'ats' | 'freshness' | 'relevancy';
  label: string;
  earned: number; // points earned (1 decimal)
  max: number; //   points available in this dimension
  /** Set when the dimension is dormant and needs an action to come into play. */
  locked?: string;
};

export type Strength = {
  score: number; //     0–100, points earned
  ceiling: number; //   the max reachable right now (grows when targets are flagged)
  headroom: number; //  ceiling − score: points available to earn now
  label: string;
  components: StrengthComponent[];
  signals: GraphSignals;
  gaps: string[]; //    concrete, human "to strengthen" hints
};

// Component weights (sum to 100). Relevancy is a big slice that starts empty for a
// fresh graph, so a good seed lands mid-band with real headroom instead of saturating.
const WEIGHTS = { foundation: 25, quantified: 22, ats: 13, freshness: 15, relevancy: 25 } as const;
const FRESH_HALF_LIFE_DAYS = 120; // evidence half-decays over ~4 months of no updates
const REL_K = 40; //                 relevancy curve constant: earned = max·covered/(covered+K) → never saturates
const DAY_MS = 86_400_000;
// The meter never "completes": even a maximal, heavily-covered graph asymptotes below this,
// so 100 stays permanently just out of reach — the visible face of the never-done model.
export const MAX_STRENGTH = 99;

// ── Live requirement coverage (M1 / Issue 5) ─────────────────────────────────
// Coverage was frozen at screening time, so coaching a gap never moved the meter. These
// pure helpers let coverage be recomputed against the CURRENT graph: a requirement counts
// as covered when a strong majority of its salient terms already appear in the evidence.
// Deterministic (no LLM) — a lightweight successor to the screening judgment, and biased to
// UNDER-claim (stricter ratio) so the meter never overstates coverage. Callers OR this with
// the original screening verdict, so it only ever ADDS coverage, never removes the baseline.
const COVERAGE_MATCH_RATIO = 0.6;
const COVERAGE_STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'with', 'from', 'that', 'this', 'have', 'has', 'was',
  'are', 'their', 'they', 'them', 'will', 'been', 'into', 'over', 'under', 'across', 'within',
  'able', 'strong', 'proven', 'using', 'while', 'other', 'each', 'more', 'most', 'such', 'led',
  'role', 'roles', 'work', 'year', 'years', 'plus', 'who', 'how', 'why', 'all', 'any', 'out',
  'own', 'key', 'via', 'end', 'good', 'great', 'well', 'level', 'strong',
]);

/** Split text into lowercased word tokens, preserving `&` and internal hyphens (M&A, cross-functional). */
function tokenizeCoverage(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9&\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}

/** The set of tokens (len ≥ 3) that appear anywhere in the graph's evidence. */
export function evidenceTokens(g: CareerGraph): Set<string> {
  const parts = [
    ...g.stars.map((s) => `${s.title ?? ''} ${s.summary ?? ''}`),
    ...g.actions.map((a) => a.text ?? ''),
    ...g.results.map((r) => r.text ?? ''),
    ...g.responsibilities.map((r) => r.text ?? ''),
    ...g.competences.map((c) => c.competence ?? ''),
    ...g.skills.map((s) => `${s.skill ?? ''} ${(s.atsKeywordVariants ?? []).join(' ')}`),
    ...g.positions.map((p) => `${p.title ?? ''} ${p.summary ?? ''}`),
    ...g.bullets.map((b) => b.text ?? ''),
  ];
  const set = new Set<string>();
  for (const tok of tokenizeCoverage(parts.join(' '))) if (tok.length >= 3) set.add(tok);
  return set;
}

/** The meaningful (non-stopword, len ≥ 3) terms of a requirement. Pure. */
export function salientTerms(requirement: string): string[] {
  return Array.from(new Set(tokenizeCoverage(requirement).filter((w) => w.length >= 3 && !COVERAGE_STOPWORDS.has(w))));
}

/**
 * Does the current graph evidence this requirement? True when ≥ COVERAGE_MATCH_RATIO of the
 * requirement's salient terms appear in the evidence token set. Pure — unit-tested.
 */
export function graphCoversRequirement(requirement: string, tokens: Set<string>): boolean {
  const terms = salientTerms(requirement);
  if (terms.length === 0) return false;
  const hits = terms.filter((t) => tokens.has(t)).length;
  return hits / terms.length >= COVERAGE_MATCH_RATIO;
}

const nonEmpty = (s: string | null | undefined) => !!s && s.trim().length > 0;
const pct = (n: number, d: number) => (d > 0 ? n / d : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const band = (s: number) =>
  s < 30 ? 'Getting started' : s < 50 ? 'Building' : s < 80 ? 'Solid start' : s < 92 ? 'Strong' : 'Comprehensive';

/** Days since the most recently updated piece of evidence (∞ if there is none). */
function daysSinceFreshest(g: CareerGraph, now: number): number {
  let newest = 0;
  const consider = (d: Date | null | undefined) => {
    if (d) newest = Math.max(newest, new Date(d).getTime());
  };
  const all = [...g.positions, ...g.stars, ...g.actions, ...g.results, ...g.skills, ...g.bullets, ...g.education, ...g.languages];
  for (const row of all) {
    const r = row as { updatedAt?: Date | null; createdAt?: Date | null };
    consider(r.updatedAt ?? r.createdAt);
  }
  if (newest === 0) return Infinity;
  return Math.max(0, (now - newest) / DAY_MS);
}

export function signalsOf(g: CareerGraph): GraphSignals {
  const resultsByStar = new Map<string, InferSelectModel<typeof starResults>[]>();
  for (const r of g.results) {
    const k = r.starRef ?? '';
    (resultsByStar.get(k) ?? resultsByStar.set(k, []).get(k)!).push(r);
  }
  const storiesWithImpact = g.stars.filter((s) =>
    (resultsByStar.get(s.refCode ?? '') ?? []).some((r) => nonEmpty(r.metric))
  ).length;

  return {
    positions: g.positions.length,
    stars: g.stars.length,
    actions: g.actions.length,
    results: g.results.length,
    quantifiedResults: g.results.filter((r) => nonEmpty(r.metric)).length,
    competences: g.competences.length,
    attributes: g.attributes.length,
    responsibilities: g.responsibilities.length,
    skills: g.skills.length,
    skillsWithAts: g.skills.filter((s) => (s.atsKeywordVariants ?? []).length > 0).length,
    education: g.education.length,
    languages: g.languages.length,
    bullets: g.bullets.length,
    storiesWithImpact,
  };
}

/**
 * The compounding, never-saturating strength model (M1 / Phase 1C). Deterministic —
 * nothing here calls the LLM. Five weighted dimensions:
 *   Foundation, Quantified impact, ATS coverage, Freshness, Relevancy vs. flagged targets.
 * Relevancy is earned only by covering the requirements of roles you're chasing, and
 * approaches its cap asymptotically — so the meter never dies, and flagging a new target
 * raises the *ceiling* (headroom) without ever dropping the earned score.
 *
 * `now` is injectable so freshness is testable/deterministic.
 */
export function strengthOf(g: CareerGraph, now: number = Date.now()): Strength {
  const s = signalsOf(g);
  const t = g.targets ?? EMPTY_TARGETS;

  // Foundation /25 — identity + role breadth + education/languages + a bullet bank.
  const foundation =
    (nonEmpty(g.profile?.name) ? 6 : 0) +
    (Math.min(s.positions, 4) / 4) * 12 +
    (s.education > 0 ? 4 : 0) +
    (s.languages > 0 ? 2 : 0) +
    (s.bullets > 0 ? 1 : 0);

  // Quantified impact /22 — share of stories carrying a number, needing ~6 to max out.
  const quantified = (s.storiesWithImpact / Math.max(s.stars, 6)) * WEIGHTS.quantified;

  // ATS coverage /13 — share of skills with keyword variants.
  const ats = pct(s.skillsWithAts, Math.max(s.skills, 1)) * WEIGHTS.ats;

  // Freshness /15 — decays from the most recently updated evidence.
  const days = daysSinceFreshest(g, now);
  const freshFactor = Number.isFinite(days) ? Math.pow(0.5, days / FRESH_HALF_LIFE_DAYS) : 0;
  const freshness = WEIGHTS.freshness * freshFactor;

  // Relevancy /25 — earned by covering flagged targets' requirements; asymptotic so it
  // never saturates. Depends only on `covered`, so flagging an uncovered target can't
  // drop it. The dimension is "unlocked" (counts toward the ceiling) once any target exists.
  const relevancyUnlocked = t.flaggedLeads > 0;
  const relevancy = WEIGHTS.relevancy * (t.covered / (t.covered + REL_K));

  const rawScore = foundation + quantified + ats + freshness + relevancy;
  const score = Math.min(MAX_STRENGTH, Math.round(rawScore));
  const ceiling =
    WEIGHTS.foundation +
    WEIGHTS.quantified +
    WEIGHTS.ats +
    WEIGHTS.freshness +
    (relevancyUnlocked ? WEIGHTS.relevancy : 0);
  const headroom = Math.max(0, ceiling - score);

  const components: StrengthComponent[] = [
    { key: 'foundation', label: 'Foundation', earned: r1(foundation), max: WEIGHTS.foundation },
    { key: 'quantified', label: 'Quantified impact', earned: r1(quantified), max: WEIGHTS.quantified },
    { key: 'ats', label: 'ATS coverage', earned: r1(ats), max: WEIGHTS.ats },
    { key: 'freshness', label: 'Freshness', earned: r1(freshness), max: WEIGHTS.freshness },
    {
      key: 'relevancy',
      label: 'Relevancy to targets',
      earned: r1(relevancy),
      max: WEIGHTS.relevancy,
      locked: relevancyUnlocked ? undefined : 'Flag a role you’re targeting to unlock',
    },
  ];

  const gaps: string[] = [];
  if (!nonEmpty(g.profile?.name)) gaps.push('Add your name and headline.');
  if (s.stars === 0) gaps.push('Add your first STAR story — the backbone of your evidence.');
  const thinStories = s.stars - s.storiesWithImpact;
  if (thinStories > 0)
    gaps.push(`${thinStories} ${thinStories === 1 ? 'story has' : 'stories have'} no quantified result yet.`);
  const missingAts = s.skills - s.skillsWithAts;
  if (s.skills > 0 && missingAts > 0)
    gaps.push(`${missingAts} ${missingAts === 1 ? 'skill is' : 'skills are'} missing ATS keyword variants.`);
  if (s.skills === 0) gaps.push('Add skills with their ATS keyword variants.');
  if (!relevancyUnlocked)
    gaps.push('Flag a role you’re targeting — it focuses your evidence and unlocks 25 points of headroom.');
  else if (t.open > 0)
    gaps.push(`${t.open} requirement${t.open === 1 ? '' : 's'} on your target roles aren’t strongly evidenced yet.`);

  return { score, ceiling, headroom, label: band(score), components, signals: s, gaps };
}
