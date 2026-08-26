/**
 * C3 — choose which of the approved evidence reaches the CV.
 *
 * `Process/C3. Select the CV Evidence Set.md`, specified by
 * CI · C3 Selects the CV Evidence Set. Nothing in the C-phase used to choose a
 * SET: C2 proposes every honest requirement→evidence link, the owner approves
 * rows one at a time, and everything approved printed. Section sizes therefore
 * tracked how much evidence was approved rather than what a two-page CV holds.
 *
 * Pure on purpose — no DB and no LLM import, the same reasoning as
 * `lib/pipeline/skills.ts`. The interesting behaviour here is the CHOICE, and a
 * choice that can only be observed by running the pipeline against Postgres
 * with an API key cannot be pinned by a test.
 *
 * ── Why code and not a model call (CI §2.5) ────────────────────────────────
 * The objective below is submodular under a cardinality constraint, so plain
 * greedy is provably within 1 − 1/e of optimal, and at the real sizes here
 * (n ≈ 22–30 candidate refs, B ≈ 14) greedy plus a pairwise swap pass is
 * effectively exact and runs in milliseconds. It is also deterministic and
 * explainable — this module reports why each item was chosen and what it
 * displaced, which a model call cannot. Same house rule as the head of
 * `tailoring.ts`: the LLM emits judgments, code decides. Selection is
 * arithmetic over judgments C2 already made.
 *
 * ── Items are refs, not rows ───────────────────────────────────────────────
 * One distinct evidence ref becomes one bullet. `requirement_tailoring` is one
 * row per requirement×evidence link, and the same strong bullet legitimately
 * answers several requirements — 64 green rows on the Julius Baer lead are 35
 * distinct refs. Reasoning about the budget in rows sets it about a third too
 * tight, which is the mistake this module exists downstream of.
 */

import { CV_SLOTS, slotCode } from '../cv-slots';

// ── Parameters ───────────────────────────────────────────────────────────────

/**
 * Every number the selection is steered by, in one place, because none of them
 * is settled.
 *
 * **`budget` is a parameter, not a constant (CI §2.6).** The owner has
 * deliberately deferred CV template and output-format work until the content is
 * right, so a page budget calibrated against a template that is about to change
 * is a number nobody should trust. 14 is the midpoint of the owner's own 13–16
 * estimate and nothing more. `SKILLS_ENVELOPE = 40` in `skills.ts` is exactly
 * what it looks like a month later when a provisional number is written down as
 * a constant and then cited as though it were considered — the step report
 * records the resulting bullet count and objective value so this one stays
 * judged rather than inherited. Re-calibration belongs to the format CI and
 * touches this object, not the algorithm.
 *
 * `alpha` and `beta` are deliberately small relative to the coverage term: on a
 * real lead the coverage term reaches ~45 while the ATS and impact terms reach
 * ~5 and ~2. They are tie-breakers among sets that cover equally well, which is
 * the role §2.3 gives them — they must not be able to buy a covered
 * requirement's place.
 */
export type SelectionParams = {
  /** `B` — how many distinct evidence refs become bullets. */
  budget: number;
  /** No more than this many bullets under any one position (CI §2.4). */
  perPositionCap: number;
  /** The N most recent positions that have candidates must each keep ≥1. */
  floorPositions: number;
  /** Weight on ATS keyword breadth (distinct requirement skills covered). */
  alpha: number;
  /** Weight on the quantified-outcome bonus. */
  beta: number;
};

export const DEFAULT_SELECTION_PARAMS: SelectionParams = {
  budget: 14,
  perPositionCap: 4,
  floorPositions: 3,
  alpha: 0.1,
  beta: 0.15,
};

// ── Inputs ───────────────────────────────────────────────────────────────────

/** One requirement→evidence link, i.e. one green `requirement_tailoring` row. */
export type SelectionLink = {
  requirementId: string;
  /** The matched requirement's B2 rank: Core | Important | Nice-to-Have. */
  rank: string | null;
  /** C2's judgement, recovered from the row via `storedMatchStrength`. */
  matchStrength: string | null;
  /** `requirement_tailoring.requirement_skills` — the JD's own asks. */
  requirementSkills: readonly string[];
};

/** One distinct evidence ref = one candidate bullet. */
export type SelectionCandidate = {
  ref: string;
  /** Every green link this ref carries, across all the rows that share it. */
  links: readonly SelectionLink[];
  /** A canonical `CV_SLOTS` label, or null if the ref has no slot. */
  cvPosition: string | null;
  /** The snapshotted evidence text — what `impact` reads. */
  text: string;
  /** Owner override from the Map (CI §2.7 item 5). */
  pin?: 'pin' | 'exclude' | null;
};

/** Every requirement on the lead, so coverage can be reported over the real
 *  denominator rather than over whatever happened to have evidence. */
export type RequirementUniverse = readonly { id: string; rank: string | null }[];

// ── The objective (CI §2.3) ──────────────────────────────────────────────────

/**
 * `w(q)` — 3 Core, 2 Important, 1 Nice-to-Have.
 *
 * A requirement carrying no recognised rank still has owner-approved evidence
 * behind it, so it is not worth nothing; it queues below Nice-to-Have, matching
 * the convention `prioritiseSkills` already uses for the same case.
 */
export function requirementWeight(rank: string | null): number {
  switch ((rank ?? '').trim()) {
    case 'Core':
      return 3;
    case 'Important':
      return 2;
    case 'Nice-to-Have':
      return 1;
    default:
      return 0.5;
  }
}

/**
 * `s(q,e)` — how well this evidence answers this requirement, on 0–1.
 *
 * The ORDER is `matchStrengthToScore`'s, and a test pins that it stays so. The
 * VALUES are not: `matchStrengthToScore` is a 0–10 fit score whose spacing was
 * chosen for B6's weighted rollup, and CI §2.3 specifies these four on 0–1 for
 * the objective. Re-deriving them by dividing by 9 would silently change the
 * ratios the note argued for, so they are stated.
 *
 * `No Match` and an unrecognised/absent label are this module's own additions —
 * §2.3 lists only the four above. `No Match` scores low but not zero (it is
 * still an owner-approved row, and zero would make it invisible rather than
 * merely last); an unrecognised label is treated as `Weak`, the conservative
 * reading, so a legacy row written before C2 stamped the label cannot score
 * itself above what it earned.
 */
export function matchQuality(matchStrength: string | null): number {
  switch ((matchStrength ?? '').trim()) {
    case 'Excellent':
      return 1.0;
    case 'Very Strong':
      return 0.85;
    case 'Good':
      return 0.7;
    case 'Weak':
      return 0.4;
    case 'No Match':
      return 0.15;
    default:
      return 0.4;
  }
}

const MEASURED = /—\s*measured:/i;
const FIGURE = /(\d[\d.,]*\s*%)|((?:EUR|USD|GBP|CHF|BRL|€|\$|£)\s*\d)|(\d[\d.,]*\s*(?:million|billion|bn\b|m\b|k\b))/i;

/**
 * `impact(e)` — does this evidence carry a measurable outcome?
 *
 * Two tiers, and the top one is the reason
 * CI · STAR Results Never Reach the Evidence Graph had to land first. That CI
 * made `gatherEvidence` compose a STAR result's own `metric` column into its
 * text as "… — measured: <metric>", and those figures appear NOWHERE in the
 * prose: `[2-R1]`'s text names the branches consolidated and never says
 * "EUR 1.5B". Scoring impact off prose alone would miss all 22 of them, which
 * is the whole reason the build order is what it is.
 *
 * The lower tier is a plain figure in the prose — a percentage, a currency
 * amount, or a magnitude. Deliberately narrow: a bare integer ("10 department
 * heads", "600 tasks") is scale, not a measured outcome, and counting it would
 * make the term fire on most of the bank and stop discriminating.
 */
export function impact(text: string): number {
  const t = text ?? '';
  if (MEASURED.test(t)) return 1;
  if (FIGURE.test(t)) return 0.5;
  return 0;
}

export type ObjectiveBreakdown = {
  /** Σ w(q) × max s(q,e) over covered requirements. */
  coverage: number;
  /** α × distinct requirement skills covered. */
  skills: number;
  /** β × Σ impact(e). */
  impact: number;
  total: number;
};

const norm = (s: string): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * `V(S)`.
 *
 * **The `max` is the mechanism (CI §2.3).** A second bullet on a requirement
 * already covered at Excellent adds almost nothing, so redundancy stops paying
 * and breadth wins without any explicit anti-duplication rule. That is also
 * what makes V submodular, which is what makes greedy provably good.
 */
export function objective(
  set: readonly SelectionCandidate[],
  params: SelectionParams = DEFAULT_SELECTION_PARAMS
): ObjectiveBreakdown {
  const best = new Map<string, { weight: number; quality: number }>();
  const skills = new Set<string>();
  let impactSum = 0;
  for (const c of set) {
    impactSum += impact(c.text);
    for (const l of c.links) {
      if (!l.requirementId) continue;
      const q = matchQuality(l.matchStrength);
      const prev = best.get(l.requirementId);
      if (!prev || q > prev.quality) best.set(l.requirementId, { weight: requirementWeight(l.rank), quality: q });
      for (const s of l.requirementSkills ?? []) if (norm(s)) skills.add(norm(s));
    }
  }
  let coverage = 0;
  for (const { weight, quality } of best.values()) coverage += weight * quality;
  const skillsTerm = params.alpha * skills.size;
  const impactTerm = params.beta * impactSum;
  return { coverage, skills: skillsTerm, impact: impactTerm, total: coverage + skillsTerm + impactTerm };
}

// ── Constraints (CI §2.4) ────────────────────────────────────────────────────

/**
 * Which position a candidate sits under — the `A`/`B`/`C`/`D` letter of its
 * `CV_SLOTS` slot. `null` for a ref with no slot; such a ref is exempt from the
 * per-position cap because there is no position to crowd, and it cannot satisfy
 * a floor for the same reason.
 */
export function positionOf(cvPosition: string | null): string | null {
  if (!cvPosition) return null;
  const code = slotCode(cvPosition);
  return /^[A-Z]/.test(code) ? code[0] : null;
}

/**
 * Positions in CV order, most recent first, taken from `CV_SLOTS` itself rather
 * than from the alphabet — the slot list is the thing that actually decides the
 * CV's order, and a second hard-coded ordering here would be one more thing to
 * keep in sync.
 */
export const POSITION_ORDER: readonly string[] = [...new Set(CV_SLOTS.map((s) => slotCode(s)[0]))];

/** Cardinality alone will happily put nine bullets on one role and none on the
 *  next, which is a score and not a CV. */
export function positionCounts(set: readonly SelectionCandidate[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of set) {
    const p = positionOf(c.cvPosition);
    if (!p) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return counts;
}

/**
 * The positions the floor applies to: the `floorPositions` most recent ones
 * that actually have a candidate. A position with nothing to offer cannot be
 * floored — requiring it would make the constraint unsatisfiable rather than
 * strict, the same distinction `missingC4Refs` draws for ref-less rows.
 */
export function flooredPositions(
  candidates: readonly SelectionCandidate[],
  params: SelectionParams = DEFAULT_SELECTION_PARAMS
): string[] {
  const available = new Set(candidates.map((c) => positionOf(c.cvPosition)).filter((p): p is string => !!p));
  return POSITION_ORDER.filter((p) => available.has(p)).slice(0, Math.max(0, params.floorPositions));
}

// ── The algorithm (CI §2.5) ──────────────────────────────────────────────────

export type SelectedItem = {
  ref: string;
  /** 1-based, in the order the items finally stand. This is `shortlist_rank`. */
  rank: number;
  /** ΔV this item contributed when it was taken. */
  gain: number;
  /** Requirement ids this item was the first in `S` to cover. */
  newlyCovered: string[];
  position: string | null;
  pinned: boolean;
};

export type DroppedItem = {
  ref: string;
  /** ΔV it would have added to the final set — what it was beaten by. */
  gain: number;
  position: string | null;
  /** Why it is not in `S`: the owner excluded it, the cap was full, or it
   *  simply never won a round. */
  reason: 'excluded' | 'position cap' | 'outranked';
};

export type SwapNote = { out: string; in: string; delta: number };

export type CoverageReport = {
  byRank: Record<string, { covered: number; total: number }>;
  /** Requirement ids covered by the set. */
  covered: Set<string>;
};

export type SelectionResult = {
  selected: SelectedItem[];
  dropped: DroppedItem[];
  objective: ObjectiveBreakdown;
  swaps: SwapNote[];
  /** Human-readable record of every constraint action taken. */
  notes: string[];
  params: SelectionParams;
};

/** Deterministic ordering. Every comparison in this module falls back to the
 *  ref string, so the same inputs produce the same set on every run — CI §2.8's
 *  last acceptance criterion, and the reason no `Math.random` and no clock
 *  reading appears anywhere below. */
const byRefAsc = (a: SelectionCandidate, b: SelectionCandidate) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);

/**
 * Floating-point slack for "the same marginal value". Gains are sums of
 * products of small decimals, so exact equality is the wrong test.
 */
const EPS = 1e-9;

/**
 * ── The tie-break, and why it is not decoration ──────────────────────────────
 *
 * Measured on all three real leads the day this was built: V goes FLAT after
 * about the sixth pick. ALDI reaches 100% Core and Important coverage in 4
 * bullets, Julius Baer in 5, Aliaxis in 6 — §1's "coverage is already
 * saturated" is if anything understated — and past that point every remaining
 * candidate has a marginal gain of exactly +0.00. Coverage is maxed, and the
 * ATS term cannot break the tie either: `requirement_skills` is B2's ask on the
 * REQUIREMENT, so once a requirement is covered every further bullet linking it
 * contributes skills already counted. The α term is therefore a function of
 * which requirements are covered, which is what the coverage term already
 * measures — it discriminates between sets that cover DIFFERENT requirements
 * and cannot discriminate between sets that cover the same ones.
 *
 * So with B = 14 and the objective maxed at ~6, the last eight bullets of every
 * CV are decided by whatever the tie-break happens to be. Left implicit that is
 * alphabetical order of the ref code, which is not a reason to put a bullet on
 * a CV.
 *
 * This is deliberately a TIE-BREAK and not a fourth term in V: §2.3's objective
 * ships exactly as argued, and wherever V discriminates at all it wins
 * outright. Only in the flat region does this decide, and it decides by asking
 * the one question left: of two bullets that add the same nothing to the set,
 * which is worth more on its own? That is `V({c})` — the same objective, over
 * the singleton — so it needs no new concepts and no new constants. In practice
 * it means the surplus budget fills with the candidate's strongest remaining
 * evidence rather than with whatever sorts first.
 *
 * The flatness itself is reported to the step report rather than hidden here.
 * A budget the objective cannot spend is a fact about the budget (CI §2.6), and
 * the honest response to it is re-calibration or better recall upstream, not a
 * cleverer tie-break.
 */
function standalone(c: SelectionCandidate, params: SelectionParams): number {
  return objective([c], params).total;
}

/** True when `c` should beat the incumbent: strictly better marginal gain, or
 *  an equal gain and more standalone value, or both equal and an earlier ref. */
function beats(
  c: SelectionCandidate,
  gain: number,
  best: SelectionCandidate | null,
  bestGain: number,
  params: SelectionParams
): boolean {
  if (!best) return true;
  if (gain > bestGain + EPS) return true;
  if (gain < bestGain - EPS) return false;
  const a = standalone(c, params);
  const b = standalone(best, params);
  if (a > b + EPS) return true;
  if (a < b - EPS) return false;
  return c.ref < best.ref;
}

function coveredIds(set: readonly SelectionCandidate[]): Set<string> {
  const out = new Set<string>();
  for (const c of set) for (const l of c.links) if (l.requirementId) out.add(l.requirementId);
  return out;
}

/**
 * Greedy, then a floor repair, then pairwise swaps.
 *
 * Greedy alone can leave a recent role unrepresented (it optimises coverage,
 * and one role's bullets may simply answer more requirements), so the floor is
 * repaired afterwards by paying for it out of the most over-represented
 * position — explicitly, and recorded in `notes`, because "the algorithm put
 * nothing under your current job" is exactly the kind of thing that must not
 * happen silently.
 */
export function selectEvidence(
  candidates: readonly SelectionCandidate[],
  params: SelectionParams = DEFAULT_SELECTION_PARAMS
): SelectionResult {
  const notes: string[] = [];
  const pool = [...candidates].sort(byRefAsc);
  const excluded = pool.filter((c) => c.pin === 'exclude');
  const usable = pool.filter((c) => c.pin !== 'exclude');
  if (excluded.length) notes.push(`${excluded.length} item(s) excluded by you`);

  const budget = Math.max(0, params.budget);
  const chosen: SelectionCandidate[] = [];
  const order: SelectedItem[] = [];

  const gainOf = (set: readonly SelectionCandidate[], c: SelectionCandidate): number =>
    objective([...set, c], params).total - objective(set, params).total;

  // Pinned rows enter S before greedy runs and consume budget (CI §2.7 item 5).
  // A pin is an explicit human override, so it also overrides the per-position
  // cap — the cap exists to stop the ALGORITHM lopsiding the CV, not to overrule
  // the owner. Everything greedy adds afterwards still respects the cap against
  // the resulting counts.
  const pinned = usable.filter((c) => c.pin === 'pin').slice(0, budget);
  for (const c of pinned) {
    const before = coveredIds(chosen);
    const gain = gainOf(chosen, c);
    chosen.push(c);
    order.push({
      ref: c.ref,
      rank: order.length + 1,
      gain,
      newlyCovered: [...coveredIds(chosen)].filter((q) => !before.has(q)),
      position: positionOf(c.cvPosition),
      pinned: true,
    });
  }
  if (pinned.length) notes.push(`${pinned.length} item(s) pinned by you, entered before selection`);

  const capBlocked = new Set<string>();
  while (chosen.length < budget) {
    const counts = positionCounts(chosen);
    let best: SelectionCandidate | null = null;
    let bestGain = -Infinity;
    for (const c of usable) {
      if (chosen.includes(c)) continue;
      const p = positionOf(c.cvPosition);
      if (p && (counts.get(p) ?? 0) >= params.perPositionCap) {
        capBlocked.add(c.ref);
        continue;
      }
      const g = gainOf(chosen, c);
      if (beats(c, g, best, bestGain, params)) {
        bestGain = g;
        best = c;
      }
    }
    if (!best) break;
    const before = coveredIds(chosen);
    chosen.push(best);
    order.push({
      ref: best.ref,
      rank: order.length + 1,
      gain: bestGain,
      newlyCovered: [...coveredIds(chosen)].filter((q) => !before.has(q)),
      position: positionOf(best.cvPosition),
      pinned: false,
    });
  }

  // ── Floor repair ──────────────────────────────────────────────────────────
  for (const p of flooredPositions(usable, params)) {
    if (positionCounts(chosen).has(p)) continue;
    const contenders = usable.filter((c) => positionOf(c.cvPosition) === p && !chosen.includes(c));
    if (contenders.length === 0) continue;
    let bring: SelectionCandidate | null = null;
    let bringGain = -Infinity;
    for (const c of contenders) {
      const g = gainOf(chosen, c);
      if (beats(c, g, bring, bringGain, params)) {
        bringGain = g;
        bring = c;
      }
    }
    if (!bring) continue;
    if (chosen.length < budget) {
      chosen.push(bring);
      order.push({ ref: bring.ref, rank: order.length + 1, gain: bringGain, newlyCovered: [], position: p, pinned: false });
      notes.push(`floor: added [${bring.ref}] so position ${p} is represented`);
      continue;
    }
    // Budget is spent — pay for the floor out of the most over-represented
    // position, dropping its cheapest member.
    const counts = positionCounts(chosen);
    let heaviest: string | null = null;
    for (const [pos, n] of [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
      if (n > 1) {
        heaviest = pos;
        break;
      }
    }
    if (!heaviest) continue;
    let drop: SelectionCandidate | null = null;
    let dropCost = Infinity;
    for (const c of chosen) {
      if (positionOf(c.cvPosition) !== heaviest || c.pin === 'pin') continue;
      const without = chosen.filter((x) => x !== c);
      const cost = objective(chosen, params).total - objective(without, params).total;
      if (cost < dropCost) {
        dropCost = cost;
        drop = c;
      }
    }
    if (!drop) continue;
    const dropRef = drop.ref;
    chosen.splice(chosen.indexOf(drop), 1);
    chosen.push(bring);
    const idx = order.findIndex((o) => o.ref === dropRef);
    if (idx >= 0) order.splice(idx, 1);
    order.push({ ref: bring.ref, rank: 0, gain: bringGain, newlyCovered: [], position: p, pinned: false });
    notes.push(`floor: swapped out [${dropRef}] (position ${heaviest}) for [${bring.ref}] so position ${p} is represented`);
  }

  // ── Pairwise swap local search ────────────────────────────────────────────
  // Greedy is within 1 − 1/e in theory; at n ≈ 30 and B = 14 the swap pass
  // closes essentially all of the remaining gap, and it costs microseconds.
  // Bounded so a pathological cycle cannot spin.
  const swaps: SwapNote[] = [];
  const floors = new Set(flooredPositions(usable, params));
  const admissible = (set: readonly SelectionCandidate[]): boolean => {
    const counts = positionCounts(set);
    for (const [, n] of counts) if (n > params.perPositionCap) return false;
    for (const p of floors) if (!counts.has(p)) return false;
    return true;
  };
  for (let pass = 0; pass < 8; pass++) {
    let bestDelta = 1e-9;
    let bestOut: SelectionCandidate | null = null;
    let bestIn: SelectionCandidate | null = null;
    const baseline = objective(chosen, params).total;
    for (const out of chosen) {
      if (out.pin === 'pin') continue;
      for (const inc of usable) {
        if (chosen.includes(inc)) continue;
        const trial = chosen.filter((x) => x !== out).concat(inc);
        if (!admissible(trial)) continue;
        const delta = objective(trial, params).total - baseline;
        if (delta > bestDelta) {
          bestDelta = delta;
          bestOut = out;
          bestIn = inc;
        }
      }
    }
    if (!bestOut || !bestIn) break;
    const outRef = bestOut.ref;
    chosen.splice(chosen.indexOf(bestOut), 1);
    chosen.push(bestIn);
    const idx = order.findIndex((o) => o.ref === outRef);
    if (idx >= 0) order.splice(idx, 1);
    order.push({ ref: bestIn.ref, rank: 0, gain: bestDelta, newlyCovered: [], position: positionOf(bestIn.cvPosition), pinned: false });
    swaps.push({ out: outRef, in: bestIn.ref, delta: bestDelta });
  }

  // Renumber after the repair and swap passes so `shortlist_rank` is a dense
  // 1..N over the items that actually stand, not the order greedy first reached
  // for them.
  const finalOrder = order
    .filter((o) => chosen.some((c) => c.ref === o.ref))
    .map((o, i) => ({ ...o, rank: i + 1 }));

  const chosenRefs = new Set(chosen.map((c) => c.ref));
  const dropped: DroppedItem[] = pool
    .filter((c) => !chosenRefs.has(c.ref))
    .map((c) => ({
      ref: c.ref,
      gain: c.pin === 'exclude' ? 0 : gainOf(chosen, c),
      position: positionOf(c.cvPosition),
      reason:
        c.pin === 'exclude' ? ('excluded' as const) : capBlocked.has(c.ref) ? ('position cap' as const) : ('outranked' as const),
    }))
    .sort((a, b) => b.gain - a.gain || (a.ref < b.ref ? -1 : 1));

  return { selected: finalOrder, dropped, objective: objective(chosen, params), swaps, notes, params };
}

/**
 * Requirement coverage of a set, over the lead's whole requirement list.
 *
 * The denominator is every requirement B2 extracted, not every requirement that
 * happened to attract evidence — a requirement nothing covers is the fact worth
 * seeing, and measuring against the evidence would hide it by construction.
 */
export function coverageOf(set: readonly SelectionCandidate[], universe: RequirementUniverse): CoverageReport {
  const covered = coveredIds(set);
  const byRank: Record<string, { covered: number; total: number }> = {};
  for (const q of universe) {
    const key = q.rank ?? 'Unranked';
    if (!byRank[key]) byRank[key] = { covered: 0, total: 0 };
    byRank[key].total += 1;
    if (covered.has(q.id)) byRank[key].covered += 1;
  }
  return { byRank, covered };
}

/** `Core 8/8 · Important 1/1 · Nice-to-Have 0/0`, in the CI note's own order. */
export function formatCoverage(report: CoverageReport): string {
  return rankOrder(report).map((k) => `${k} ${report.byRank[k].covered}/${report.byRank[k].total}`).join(' · ');
}

function rankOrder(report: CoverageReport): string[] {
  const order = ['Core', 'Important', 'Nice-to-Have'];
  return [...order.filter((k) => report.byRank[k]), ...Object.keys(report.byRank).filter((k) => !order.includes(k))];
}

/** A group of requirements answered by a CV section that prints regardless of
 *  selection — `label` is what it is called in the coverage line ("EDU", "LAN"). */
export type ExemptGroup = { label: string; set: readonly SelectionCandidate[] };

/**
 * CI · C2 Never Sees Nice-to-Have Requirements §2.3 — the two coverage readings
 * in one line, in the format the owner agreed on 2026-08-25:
 *
 * ```
 * Core 7/8 + 1 LAN · Important 11/13 + 1 EDU + 1 LAN
 * ```
 *
 * Bullet-borne coverage first, because that is the part selection actually
 * controls, then what the fixed sections answer on top of it. Reporting only
 * the first number scores C3 down for obeying its own §2.4 — Education and
 * Language evidence is deliberately kept out of the bullet budget, so a Core
 * requirement answered only by a degree reads as uncovered even though the CV
 * plainly answers it. Reporting only the combined number hides the same fact
 * from the other side. Neither reading is wrong; publishing one of them alone is.
 *
 * A requirement that several exempt groups answer is attributed to the first
 * group listed, so the `+` terms sum to the difference between the readings
 * rather than double-counting it.
 */
export function formatCoverageSplit(
  bullets: CoverageReport,
  universe: RequirementUniverse,
  exempt: readonly ExemptGroup[]
): string {
  const attributed = new Set(bullets.covered);
  const extra: Record<string, Record<string, number>> = {};
  for (const group of exempt) {
    const covered = coveredIds(group.set);
    for (const q of universe) {
      if (!covered.has(q.id) || attributed.has(q.id)) continue;
      attributed.add(q.id);
      const key = q.rank ?? 'Unranked';
      (extra[key] ??= {})[group.label] = ((extra[key] ?? {})[group.label] ?? 0) + 1;
    }
  }
  return rankOrder(bullets)
    .map((k) => {
      const adds = Object.entries(extra[k] ?? {}).map(([label, n]) => ` + ${n} ${label}`).join('');
      return `${k} ${bullets.byRank[k].covered}/${bullets.byRank[k].total}${adds}`;
    })
    .join(' · ');
}
