/**
 * Discover — Mirror + Unexpected Doors (Additive Plan · C2). Scores the curated
 * role archetypes against the user's graph using the EXISTING B6 requirement-
 * alignment formula (same maths, new inputs — zero scoring changes), then splits
 * them into two lenses:
 *   • Mirror — the shapes that reflect who the evidence says you already are.
 *   • Unexpected Doors — adjacent shapes (a different family) you score
 *     surprisingly well on but may not have considered.
 *
 * Coverage per requirement reuses graphCoversRequirement (the same test the
 * strength meter and Coverage Matrix use), so "covered" means one honest thing
 * everywhere in the app.
 */
import { requirementAlignment } from './scoring';
import { evidenceTokens, graphCoversRequirement, type CareerGraph } from './career-graph';
import { ARCHETYPES, type Archetype } from './archetypes';

export type ScoredArchetype = {
  key: string;
  title: string;
  family: string;
  blurb: string;
  fit: number; //          0–10, from requirementAlignment
  covered: number;
  total: number;
  gaps: string[]; //       uncovered requirements, for the "what you'd need" hint
};

const COVERED_SCORE = 8; // a covered requirement scores like a Good match
const UNCOVERED_SCORE = 2; // an uncovered one scores like a Weak match

function scoreArchetype(a: Archetype, tokens: Set<string>): ScoredArchetype {
  const perReq = a.requirements.map((r) => ({
    covered: graphCoversRequirement(r.requirement, tokens),
    rank: r.rank,
    requirement: r.requirement,
  }));
  const fit = requirementAlignment(perReq.map((r) => ({ score: r.covered ? COVERED_SCORE : UNCOVERED_SCORE, rank: r.rank })));
  const covered = perReq.filter((r) => r.covered).length;
  return {
    key: a.key,
    title: a.title,
    family: a.family,
    blurb: a.blurb,
    fit,
    covered,
    total: perReq.length,
    gaps: perReq.filter((r) => !r.covered).map((r) => r.requirement),
  };
}

// ── R4 · Test a Door (board #5c) ─────────────────────────────────────────────
// An honest verdict on an unexpected role *before* you commit. A pure projection
// over the already-computed B6 fit + coverage — deterministic, and it names the
// stretch rather than flattering it (the anti-optimisation non-negotiable).

export type DoorStance = 'adjacency' | 'stretch' | 'reach';
export type DoorVerdict = {
  stance: DoorStance;
  line: string; //         one honest sentence
  strengthen: string[]; // up to two gaps to close first
};

export function doorVerdict(d: { fit: number; covered: number; total: number; gaps: string[] }): DoorVerdict {
  const ratio = d.total > 0 ? d.covered / d.total : 0;
  const strengthen = d.gaps.slice(0, 2);
  const nGap = d.gaps.length;
  const gapPhrase = nGap === 0 ? 'nothing obvious' : `${nGap} gap${nGap === 1 ? '' : 's'}`;
  if (d.fit >= 6 && ratio >= 0.6) {
    return {
      stance: 'adjacency',
      strengthen,
      line: `A real adjacency, not a leap — your evidence already covers ${d.covered} of ${d.total} must-haves. A door you can walk through.`,
    };
  }
  if (d.fit >= 4.5) {
    return {
      stance: 'stretch',
      strengthen,
      line: `A genuine stretch — reachable, but you'd walk in with ${gapPhrase} to close first. Worth it only if the direction pulls you.`,
    };
  }
  return {
    stance: 'reach',
    strengthen,
    line: `A reach today — the evidence isn't there yet (${d.covered}/${d.total} covered). Treat it as a direction to grow toward, not a next move.`,
  };
}

export type Discovery = { mirror: ScoredArchetype[]; doors: ScoredArchetype[] };

export function discover(graph: CareerGraph): Discovery {
  const tokens = evidenceTokens(graph);
  const scored = ARCHETYPES.map((a) => scoreArchetype(a, tokens)).sort((x, y) => y.fit - x.fit);

  // Mirror: your strongest reflections. Take the top matches that clear a real bar.
  const mirror = scored.filter((s) => s.fit >= 5.5).slice(0, 4);
  const mirrorKeys = new Set(mirror.map((s) => s.key));
  const homeFamilies = new Set(mirror.map((s) => s.family));

  // Doors: not already mirrored, a decent-but-not-obvious fit, and ideally from a
  // family you're NOT already centred on — that's what makes them "unexpected".
  const candidates = scored.filter((s) => !mirrorKeys.has(s.key) && s.fit >= 4);
  const outsideHome = candidates.filter((s) => !homeFamilies.has(s.family));
  const doors = (outsideHome.length >= 2 ? outsideHome : candidates).slice(0, 4);

  return { mirror, doors };
}
