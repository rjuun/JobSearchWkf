/**
 * M2 · The coach's prompt queue — the "never-done" engine.
 *
 * Unlike the old ephemeral `enrichmentTargets` (recomputed each load, no memory),
 * prompts are *persisted* so a skip is remembered and (M3) an approval can spawn a
 * follow-up. Two generation engines run for M2:
 *
 *   1. prior_roles      — gaps in the user's own evidence (adapts enrichmentTargets)
 *   3. target_requirements — Core/Important must-haves on roles they're chasing that
 *                            their graph doesn't strongly cover yet (demand-pull)
 *
 * Engines 2 (similar resumes) and 4 (screening gaps) + spawn arrive in M3.
 *
 * The two engines are PURE functions of their input data (testable without a DB);
 * `generatePrompts` does the IO — load, run engines, upsert preserving status.
 */
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from './db';
import { coachingAnswers, coachingPrompts, jobLeads, jobRequirements } from './db/schema';
import { getCareerGraphFor } from './queries';
import { enrichmentTargets, isBenignMisalignment } from './coaching';
import { evidenceTokens, graphCoversRequirement, type CareerGraph } from './career-graph';
import { env } from './env';

export type Tier = 'basics' | 'position_deep' | 'relevancy';

export const TIER_ORDER: Tier[] = ['basics', 'position_deep', 'relevancy'];
export const TIER_LABEL: Record<Tier, string> = {
  basics: 'Basics',
  position_deep: 'Go deeper on your positions',
  relevancy: 'Tuned to where you’re aiming',
};

export type PromptSource =
  | 'prior_roles'
  | 'similar_resumes'
  | 'target_requirements'
  | 'screening_gap'
  | 'excavation'
  | 'seed';

/** What an engine wants to exist. `generatePrompts` reconciles these with the DB. */
export type DesiredPrompt = {
  dedupeKey: string;
  tier: Tier;
  promptSource: PromptSource;
  /** M2 · cross-engine value score → queue order + hero selection. Higher = surface sooner. */
  value: number;
  contextLabel: string | null;
  question: string;
  why: string | null;
  payoff: string | null;
  sourceRef: Record<string, unknown> | null;
  targetNode: Record<string, unknown> | null;
};

// ── M2 · cross-engine value scoring ─────────────────────────────────────────
// One scale across all engines decides order (tiers become visual grouping only):
//   screening_gap (live watch-out) > target Core/Important (weighted by demand) >
//   missing metric on a real story > position summary > similar-resume pattern > ATS housekeeping.
export const VALUE = {
  screeningGap: 95,
  targetBase: 70, // + rank bonus + demand; capped below screeningGap
  metric: 55,
  summary: 45,
  similarResume: 35,
  atsBundle: 25,
  excavation: 12, // C3 · below everything: an invitation, never queued ahead of real work
} as const;

// ── Engine 1 · prior roles (intrinsic gaps) ─────────────────────────────────

const TIER_FOR_KIND: Record<string, Tier> = { metric: 'position_deep', summary: 'position_deep', ats: 'basics' };

/** Short, stable, order-independent hash of a set of ids (for the ATS bundle's dedupe key). */
function hashKey(ids: string[]): string {
  const joined = [...ids].sort().join(',');
  let h = 0;
  for (let i = 0; i < joined.length; i++) h = (h * 31 + joined.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Map the deterministic enrichment gaps onto persisted prompts. Pure.
 * M2: metric/summary gaps stay one prompt each; the per-skill ATS gaps collapse into
 * ONE bundled prompt (never six near-identical housekeeping cards).
 */
export function engine1Prompts(graph: CareerGraph): DesiredPrompt[] {
  const targets = enrichmentTargets(graph);
  const out: DesiredPrompt[] = [];

  for (const t of targets) {
    if (t.kind === 'ats') continue; // bundled below
    const isMetric = t.kind === 'metric';
    out.push({
      dedupeKey: `e1:${t.kind}:${t.rowId}`,
      tier: TIER_FOR_KIND[t.kind] ?? 'position_deep',
      promptSource: 'prior_roles',
      value: isMetric ? VALUE.metric : VALUE.summary,
      contextLabel: t.title,
      question: t.question,
      why: isMetric
        ? 'This story has no quantified result yet — a number is what makes it land.'
        : 'This role has no one-line scope yet — the headline an employer reads first.',
      payoff: isMetric ? 'Strengthens 1 story' : 'Sharpens 1 position',
      sourceRef: null,
      targetNode: { kind: t.kind, rowId: t.rowId, starRef: t.starRef ?? null },
    });
  }

  // 1B · bundle the ATS-variant housekeeping into a single multi-skill pass.
  const ats = targets.filter((t) => t.kind === 'ats');
  if (ats.length > 0) {
    const skills = ats.map((t) => ({ id: t.rowId, name: t.title }));
    const names = skills.map((s) => s.name);
    const preview = names.slice(0, 3).join(', ') + (names.length > 3 ? `, +${names.length - 3} more` : '');
    const n = skills.length;
    out.push({
      // Key off the covered set (not a constant): once answered the prompt is `done`, so a
      // constant key would never re-prompt skills you skipped or added later. A changed set
      // yields a new key → a fresh prompt; the superseded open one auto-closes as stale.
      dedupeKey: `e1:ats-bundle:${hashKey(skills.map((s) => s.id))}`,
      tier: 'basics',
      promptSource: 'prior_roles',
      value: VALUE.atsBundle,
      contextLabel: `${n} skill${n === 1 ? '' : 's'}`,
      question: `${n} skill${n === 1 ? '' : 's'} have no ATS keyword variants yet — how might a job ad phrase ${preview}? One line per skill, e.g. “Controlling: FP&A, management accounting”.`,
      why: 'ATS keyword variants let tailoring mirror the job-ad wording — only when genuinely yours.',
      payoff: `Mirrors JD wording for ${n} skill${n === 1 ? '' : 's'}`,
      sourceRef: null,
      targetNode: { kind: 'ats_bundle', skills },
    });
  }

  return out;
}

// ── Engine 3 · target-role requirements (demand-pull) ───────────────────────

export type TargetReqRow = {
  leadId: string;
  leadTitle: string;
  company: string | null;
  requirementId: string;
  requirement: string;
  rank: string | null;
  initialScore: number | null;
  initialMatchStrength: string | null;
};

const WEAK_STRENGTHS = new Set(['Weak', 'No Match']);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Whole-word/phrase membership — so 'board' doesn't match 'dashboard', 'tom' not 'custom'. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (hay: string, keyword: string) => new RegExp(`\\b${escapeRe(keyword)}\\b`, 'i').test(hay);

/** A requirement is under-evidenced if its match is weak / unscored. */
function isWeak(r: TargetReqRow): boolean {
  if (r.initialMatchStrength && WEAK_STRENGTHS.has(r.initialMatchStrength)) return true;
  if (r.initialScore == null) return true;
  return r.initialScore < 5;
}

/**
 * Group weak Core/Important requirements across the roles in play into one prompt
 * each (the same must-have asked by 3 roles is one question, not three). Pure.
 */
export function engine3Prompts(rows: TargetReqRow[], cap = 10): DesiredPrompt[] {
  const groups = new Map<string, { rows: TargetReqRow[]; rep: TargetReqRow }>();
  for (const r of rows) {
    if (!r.requirement?.trim() || !isWeak(r)) continue;
    const key = norm(r.requirement);
    const g = groups.get(key);
    if (g) {
      g.rows.push(r);
      // Prefer a Core representative over Important.
      if (r.rank === 'Core' && g.rep.rank !== 'Core') g.rep = r;
    } else {
      groups.set(key, { rows: [r], rep: r });
    }
  }

  const ranked = [...groups.entries()].sort((a, b) => {
    const core = (g: { rep: TargetReqRow }) => (g.rep.rank === 'Core' ? 1 : 0);
    return core(b[1]) - core(a[1]) || b[1].rows.length - a[1].rows.length;
  });

  return ranked.slice(0, cap).map(([key, g]) => {
    const n = g.rows.length;
    const rank = g.rep.rank ?? 'Important';
    const roles = n === 1 ? 'role' : 'roles';
    // Value: Core outranks Important, and more roles asking = higher demand. Capped below screening_gap.
    const value = VALUE.targetBase + (rank === 'Core' ? 12 : 4) + Math.min(n, 4) * 2;
    return {
      dedupeKey: `e3:${key}`,
      tier: 'relevancy',
      promptSource: 'target_requirements',
      value,
      contextLabel: n === 1 ? g.rep.leadTitle : `${g.rep.leadTitle} +${n - 1} more`,
      question: `Tell me about a time you can evidence: “${g.rep.requirement.trim()}.” What did you do, and what came of it?`,
      why: `${n} ${roles} you’re tracking ask for this, and your graph doesn’t strongly cover it yet.`,
      payoff: `Strengthens a ${rank} requirement on ${n} ${roles}`,
      sourceRef: { leadId: g.rep.leadId, requirementId: g.rep.requirementId },
      targetNode: { kind: 'story' },
    };
  });
}

// ── Engine 2 · similar leaders' resumes (corpus pattern) ────────────────────
// A small CURATED corpus of competences senior finance/transformation leaders
// commonly evidence (patterns only — never another user's content; the real
// opt-in aggregate corpus is an open question, see ROADMAP / plan §10). If the
// graph doesn't already mention one, ask about it.
const SENIOR_CORPUS: { competence: string; keywords: string[]; question: string; why: string }[] = [
  {
    competence: 'Regulatory-change programme leadership',
    keywords: ['regulatory', 'compliance', 'regulation', 'eba', 'basel'],
    question: 'Have you ever led a regulatory-change programme end to end? What was the mandate, and what did you deliver?',
    why: 'Senior finance & transformation leaders are routinely asked to evidence regulatory-change delivery.',
  },
  {
    competence: 'Post-merger integration / carve-out',
    keywords: ['integration', 'merger', 'm&a', 'pmi', 'carve', 'acquisition'],
    question: 'Have you run a post-merger integration or a carve-out? What did you own, and how did it land?',
    why: 'A common differentiator on senior operating-leadership profiles your peers tend to show.',
  },
  {
    competence: 'Operating-model / shared-services design',
    keywords: ['operating model', 'shared services', 'target operating', 'tom'],
    question: 'Have you designed or reshaped an operating model or shared-services function? What was the before/after?',
    why: 'A frequently-evidenced senior-transformation competence.',
  },
  {
    competence: 'Board / C-suite decision support',
    keywords: ['board', 'supervisory', 'executive committee', 'c-suite', 'general assembly'],
    question: 'Where have you owned board- or C-suite-level reporting and decision support?',
    why: 'Peers at your level almost always evidence board-facing work.',
  },
];

/** Competences peers commonly show that the graph doesn't mention yet. Pure. */
export function engine2Prompts(graph: CareerGraph, cap = 4): DesiredPrompt[] {
  const hay = [
    ...graph.skills.map((s) => s.skill ?? ''),
    ...graph.competences.map((c) => c.competence ?? ''),
    ...graph.responsibilities.map((r) => r.text ?? ''),
    ...graph.stars.map((s) => `${s.title ?? ''} ${s.summary ?? ''}`),
    ...graph.positions.map((p) => `${p.title ?? ''} ${p.summary ?? ''}`),
  ]
    .join(' ')
    .toLowerCase();

  const out: DesiredPrompt[] = [];
  for (const item of SENIOR_CORPUS) {
    if (item.keywords.some((k) => mentions(hay, k))) continue; // already covered — don't ask
    out.push({
      dedupeKey: `e2:${norm(item.competence)}`,
      tier: 'basics',
      promptSource: 'similar_resumes',
      value: VALUE.similarResume,
      contextLabel: 'Common at your level',
      question: item.question,
      why: item.why,
      payoff: 'Matches what peers evidence',
      sourceRef: null,
      targetNode: { kind: 'story' },
    });
    if (out.length >= cap) break;
  }
  return out;
}

// ── Engine 4 · screening gaps (the B → Coach bridge) ────────────────────────

export type MisalignmentRow = {
  leadId: string;
  leadTitle: string;
  company: string | null;
  dimension: string;
  detail: string;
  severity: string | null;
};

/** Turn B3 misalignments raised during screening into enrich prompts. Pure. */
export function engine4Prompts(rows: MisalignmentRow[], cap = 8): DesiredPrompt[] {
  const seen = new Set<string>();
  const out: DesiredPrompt[] = [];
  for (const r of rows) {
    const dim = (r.dimension ?? '').trim();
    if (!dim) continue;
    // B3 sometimes records a checked-but-fine dimension; don't dress that as a gap.
    if (isBenignMisalignment(dim, r.detail, r.severity)) continue;
    const key = `e4:${r.leadId}:${norm(dim)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const detail = (r.detail ?? '').trim();
    out.push({
      dedupeKey: key,
      tier: 'relevancy',
      promptSource: 'screening_gap',
      value: VALUE.screeningGap,
      contextLabel: r.leadTitle,
      question: `${r.leadTitle} flagged ${dim.toLowerCase()}${detail ? ` — ${detail}` : ''}. Can you point to a time that shows otherwise?`,
      why: `Screening raised this as a watch-out on ${r.company ?? r.leadTitle}. Evidence here can turn a flag into a strength.`,
      payoff: 'Addresses a screening watch-out',
      sourceRef: { leadId: r.leadId, dimension: dim },
      targetNode: { kind: 'story' },
    });
    if (out.length >= cap) break;
  }
  return out;
}

// ── Engine 5 · excavation (Additive Plan · C3) ──────────────────────────────
// Era-targeted invitations to dig up buried evidence from a thinly-documented
// role. Lowest value in the system, so they NEVER queue ahead of real work — they
// sit at the bottom as an optional "when you have a quiet moment" card. Breadcrumb:
// seeded from the position itself so each points at a specific era, not a generic
// "tell me more".
export function engine5Prompts(graph: CareerGraph, cap = 3): DesiredPrompt[] {
  const storiesByPosition = new Map<string, number>();
  for (const s of graph.stars) {
    const ref = (s.positionRef ?? '').trim();
    if (ref) storiesByPosition.set(ref, (storiesByPosition.get(ref) ?? 0) + 1);
  }
  const out: DesiredPrompt[] = [];
  for (const p of graph.positions) {
    if (!p.title) continue;
    const ref = (p.refCode ?? '').trim();
    const stories = ref ? storiesByPosition.get(ref) ?? 0 : 0;
    if (stories >= 2) continue; // this era is already well-documented
    const where = p.company ? ` at ${p.company}` : '';
    out.push({
      dedupeKey: `e5:${norm(ref || p.title)}`,
      tier: 'position_deep',
      promptSource: 'excavation',
      value: VALUE.excavation,
      contextLabel: 'Excavation',
      question: `Take me back to ${p.title}${where}. What's a moment there you're proud of but have never written down?`,
      why: 'This era is thin in your graph — a story from it can surface evidence you\'d forgotten you had.',
      payoff: 'Recovers buried evidence',
      // Carry the era + company so the surfaced invitation card (R2) can show a
      // specific eyebrow ("Director, Shared Services · Acme") without parsing the question.
      sourceRef: { positionRef: ref || null, era: p.title, company: p.company ?? null },
      targetNode: { kind: 'story', positionRef: ref || null },
    });
    if (out.length >= cap) break;
  }
  return out;
}

// ── Generation (IO) · reconcile desired prompts with the persisted queue ────

const AUTO_CLOSE_SOURCES = ['prior_roles', 'similar_resumes', 'screening_gap', 'excavation'];

type ExistingPromptForReconcile = Pick<
  typeof coachingPrompts.$inferSelect,
  'status' | 'promptSource' | 'spawnedBy' | 'dedupeKey'
>;

export function missingDesiredDisposition(p: ExistingPromptForReconcile): 'close' | 'park' | null {
  if (p.status !== 'open' || p.spawnedBy || !p.dedupeKey) return null;
  if (p.promptSource === 'target_requirements') return 'park';
  return AUTO_CLOSE_SOURCES.includes(p.promptSource) ? 'close' : null;
}

/**
 * Regenerate the queue for an owner: insert new prompts, refresh still-open ones,
 * auto-close prompts whose gap has since been resolved, park target prompts whose
 * active role disappeared, and never resurrect a prompt the user answered/skipped.
 */
export async function generatePrompts(owner: string, preloadedGraph?: CareerGraph): Promise<CareerGraph> {
  const [graph, reqRows, misRows, existing] = await Promise.all([
    preloadedGraph ? Promise.resolve(preloadedGraph) : getCareerGraphFor(owner),
    targetReqRows(owner),
    misalignmentRows(owner),
    db.select().from(coachingPrompts).where(eq(coachingPrompts.ownerId, owner)),
  ]);
  // Live coverage (Issue 5): drop target requirements the CURRENT graph already evidences,
  // so approving coached evidence for a gap stops it being re-prompted (the open prompt then
  // parks on the next regeneration). The screening-weakness gate still applies inside engine3.
  const tokens = evidenceTokens(graph);
  const uncoveredReqRows = reqRows.filter((r) => !graphCoversRequirement(r.requirement, tokens));
  const desired = [
    ...engine1Prompts(graph),
    ...engine2Prompts(graph),
    ...engine3Prompts(uncoveredReqRows),
    ...engine4Prompts(misRows),
    ...(env.nextExcavation ? engine5Prompts(graph) : []),
  ];
  const desiredByKey = new Map(desired.map((d) => [d.dedupeKey, d]));
  const existingByKey = new Map(existing.filter((p) => p.dedupeKey).map((p) => [p.dedupeKey as string, p]));

  const toInsert: (typeof coachingPrompts.$inferInsert)[] = [];
  for (const d of desired) {
    const ex = existingByKey.get(d.dedupeKey);
    if (!ex) {
      toInsert.push({ ownerId: owner, status: 'open', ...toRow(d) });
    } else if (ex.status === 'inactive' && ex.promptSource === 'target_requirements') {
      await db
        .update(coachingPrompts)
        .set({ ...toRow(d), status: 'open', updatedAt: new Date() })
        .where(eq(coachingPrompts.id, ex.id));
    } else if ((ex.status === 'open' || ex.status === 'drafted') && rowChanged(ex, d)) {
      // Refresh display text (e.g. role count changed) — but only when it actually
      // changed, so we don't fire a no-op UPDATE per prompt on every regeneration.
      await db
        .update(coachingPrompts)
        .set({ ...toRow(d), updatedAt: new Date() })
        .where(eq(coachingPrompts.id, ex.id));
    }
    // done / skipped → leave untouched.
  }
  // ON CONFLICT DO NOTHING against the (owner_id, dedupe_key) unique index makes
  // concurrent regenerations (coach load + screening + approve) idempotent.
  if (toInsert.length) await db.insert(coachingPrompts).values(toInsert).onConflictDoNothing();

  // Auto-close still-open engine prompts whose gap no longer appears — but never
  // a spawned follow-up (it has no engine to regenerate it; it stands on its own).
  // Target-role prompts are parked instead of done so unflag/reflag remains reversible.
  const staleIds: string[] = [];
  const parkedTargetIds: string[] = [];
  for (const p of existing) {
    if (!p.dedupeKey || desiredByKey.has(p.dedupeKey)) continue;
    const disposition = missingDesiredDisposition(p);
    if (disposition === 'close') staleIds.push(p.id);
    if (disposition === 'park') parkedTargetIds.push(p.id);
  }
  if (staleIds.length) {
    await db
      .update(coachingPrompts)
      .set({ status: 'done', updatedAt: new Date() })
      .where(and(eq(coachingPrompts.ownerId, owner), inArray(coachingPrompts.id, staleIds)));
  }
  if (parkedTargetIds.length) {
    await db
      .update(coachingPrompts)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(and(eq(coachingPrompts.ownerId, owner), inArray(coachingPrompts.id, parkedTargetIds)));
  }
  return graph;
}

/** Has any displayed field of an existing prompt actually changed vs. the desired one? */
function rowChanged(ex: typeof coachingPrompts.$inferSelect, d: DesiredPrompt): boolean {
  return (
    ex.question !== d.question ||
    ex.why !== d.why ||
    ex.payoff !== d.payoff ||
    ex.contextLabel !== d.contextLabel ||
    ex.tier !== d.tier ||
    ex.promptSource !== d.promptSource ||
    ex.value !== d.value ||
    JSON.stringify(ex.sourceRef ?? null) !== JSON.stringify(d.sourceRef ?? null) ||
    JSON.stringify(ex.targetNode ?? null) !== JSON.stringify(d.targetNode ?? null)
  );
}

// ── Spawn · a deeper follow-up after an approval (the "never-done" turn) ────

type SpawnTemplate = { question: string; payoff: string };
const SPAWN_RULES: { test: RegExp; tpl: SpawnTemplate }[] = [
  {
    test: /€|\$|£|\bEUR\b|\bUSD\b|budget|\bp&l\b|\d+\s*(m|bn|million|billion|k)\b/i,
    tpl: { question: 'For that — did you own it outright or jointly, and across how many years?', payoff: 'Adds ownership & duration' },
  },
  {
    test: /\bteam\b|headcount|\d+\s*(people|fte|staff|reports)\b/i,
    tpl: { question: 'How large was the team, and what measurably changed under your leadership?', payoff: 'Adds scale & outcome' },
  },
  {
    test: /programme|program|project|transformation|initiative|rollout|implementation/i,
    tpl: { question: 'Over what timeframe did that run, and what was the measurable result by the end?', payoff: 'Adds timeframe & result' },
  },
];

/** Which deeper question (if any) an answer opens up. Pure — unit-tested. */
export function spawnTemplate(text: string): SpawnTemplate | null {
  for (const r of SPAWN_RULES) if (r.test.test(text)) return r.tpl;
  return null;
}

/**
 * After an approval, surface ONE deeper follow-up if the new evidence opens a
 * question (€210M → "sole or shared? over how many years?"). Depth-capped: we
 * never spawn from a prompt that was itself a spawn, so chains stay shallow.
 */
export async function maybeSpawnFollowup(
  owner: string,
  parent: { id: string; tier: string; promptSource: string; contextLabel: string | null; spawnedBy: string | null },
  answer: { rawAnswer: string | null; draftAction: string | null; metric: string | null }
): Promise<boolean> {
  if (parent.spawnedBy) return false; // depth cap: 1 level of follow-up
  const tpl = spawnTemplate(`${answer.rawAnswer ?? ''} ${answer.draftAction ?? ''} ${answer.metric ?? ''}`);
  if (!tpl) return false;

  const dedupeKey = `spawn:${parent.id}`;
  const [exists] = await db
    .select({ id: coachingPrompts.id })
    .from(coachingPrompts)
    .where(and(eq(coachingPrompts.ownerId, owner), eq(coachingPrompts.dedupeKey, dedupeKey)));
  if (exists) return false;

  await db
    .insert(coachingPrompts)
    .values({
      ownerId: owner,
      tier: parent.tier,
      promptSource: parent.promptSource,
      contextLabel: parent.contextLabel,
      question: tpl.question,
      why: 'Your last answer opened a deeper one — a quick follow-up makes the evidence land harder.',
      payoff: tpl.payoff,
      status: 'open',
      value: 60, // a timely follow-up surfaces prominently, just under target/screening prompts
      spawnedBy: parent.id,
      targetNode: { kind: 'story' },
      dedupeKey,
    })
    .onConflictDoNothing(); // idempotent under a double-submitted approval
  return true;
}

/**
 * Is there an OPEN screening-gap prompt waiting for this lead? The workspace bridge
 * CTA gates on this (not the raw misalignment heuristic) so it can never dead-end
 * on a coach page with no matching prompt.
 */
export async function hasOpenScreeningGap(owner: string, leadId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: coachingPrompts.id })
    .from(coachingPrompts)
    .where(
      and(
        eq(coachingPrompts.ownerId, owner),
        eq(coachingPrompts.promptSource, 'screening_gap'),
        eq(coachingPrompts.status, 'open'),
        sql`${coachingPrompts.sourceRef}->>'leadId' = ${leadId}`
      )
    )
    .limit(1);
  return !!row;
}

// ── Read path (UI) ──────────────────────────────────────────────────────────

export type QueueDraft = { action: string; result: string | null; metric: string | null; needsMetric: boolean };
export type QueueItem = {
  id: string;
  tier: Tier;
  promptSource: PromptSource;
  value: number;
  contextLabel: string | null;
  question: string;
  why: string | null;
  payoff: string | null;
  status: string;
  spawnedBy: string | null;
  draft: QueueDraft | null;
};
export type QueueGroup = { tier: Tier; label: string; items: QueueItem[] };

/**
 * R2 · Excavation is surfaced apart from the ranked queue — an optional invitation,
 * never an auto-advanced hero. It carries the era + company (from sourceRef) so the
 * card can name the specific under-documented role it points back to.
 */
export type ExcavationInvite = QueueItem & { era: string | null; company: string | null };

/** The single highest-value open prompt across the queue — M3's "start here" hero. */
export function heroOf(groups: QueueGroup[]): QueueItem | null {
  let best: QueueItem | null = null;
  for (const g of groups) for (const it of g.items) if (!best || it.value > best.value) best = it;
  return best;
}

/** Hydrate persisted prompt rows into QueueItems, attaching each drafted one's latest draft. */
async function hydrateItems(
  owner: string,
  prompts: (typeof coachingPrompts.$inferSelect)[]
): Promise<QueueItem[]> {
  const draftedIds = prompts.filter((p) => p.status === 'drafted').map((p) => p.id);
  const answers = draftedIds.length
    ? await db
        .select()
        .from(coachingAnswers)
        .where(and(eq(coachingAnswers.ownerId, owner), inArray(coachingAnswers.promptId, draftedIds)))
    : [];
  const latest = new Map<string, (typeof answers)[number]>();
  for (const a of answers) {
    const cur = latest.get(a.promptId);
    if (!cur || a.createdAt > cur.createdAt) latest.set(a.promptId, a);
  }
  return prompts.map((p) => {
    const a = latest.get(p.id);
    return {
      id: p.id,
      tier: p.tier as Tier,
      promptSource: p.promptSource as PromptSource,
      value: p.value,
      contextLabel: p.contextLabel,
      question: p.question,
      why: p.why,
      payoff: p.payoff,
      status: p.status,
      spawnedBy: p.spawnedBy,
      draft: a
        ? { action: a.draftAction ?? '', result: a.draftResult, metric: a.metric, needsMetric: a.needsMetric }
        : null,
    };
  });
}

/** Open + drafted prompts, grouped by tier, each carrying its in-progress draft. */
export async function readQueue(owner: string): Promise<QueueGroup[]> {
  const prompts = await db
    .select()
    .from(coachingPrompts)
    .where(and(eq(coachingPrompts.ownerId, owner), inArray(coachingPrompts.status, ['open', 'drafted'])))
    .orderBy(desc(coachingPrompts.createdAt));

  // R2: excavation prompts are pulled out of the ranked queue entirely — they surface
  // as a separate "quiet moment" invitation (readExcavationInvites), never in the stage.
  const items = (await hydrateItems(owner, prompts)).filter((i) => i.promptSource !== 'excavation');

  // M2: tiers are visual grouping only — order by value within each group, and order the
  // groups by their strongest prompt, so the top of the queue is always the highest value
  // (a screening watch-out or a Core target requirement), never a stack of ATS cards.
  const groups = TIER_ORDER.map((t) => ({
    tier: t,
    label: TIER_LABEL[t],
    items: items.filter((i) => i.tier === t).sort((a, b) => b.value - a.value),
  })).filter((g) => g.items.length > 0);
  groups.sort((a, b) => (b.items[0]?.value ?? 0) - (a.items[0]?.value ?? 0));
  return groups;
}

/**
 * R2 · the excavation invitations — open (or in-progress) rediscovery prompts, shown
 * below the ranked queue. Newest first; each keeps its era/company eyebrow so the card
 * can point at a specific thin role ("Take me back to Director, Shared Services…").
 */
export async function readExcavationInvites(owner: string): Promise<ExcavationInvite[]> {
  const prompts = await db
    .select()
    .from(coachingPrompts)
    .where(
      and(
        eq(coachingPrompts.ownerId, owner),
        eq(coachingPrompts.promptSource, 'excavation'),
        inArray(coachingPrompts.status, ['open', 'drafted'])
      )
    )
    .orderBy(desc(coachingPrompts.createdAt));

  const items = await hydrateItems(owner, prompts);
  return items.map((it, i) => {
    const ref = (prompts[i].sourceRef ?? {}) as { era?: string | null; company?: string | null };
    return { ...it, era: ref.era ?? null, company: ref.company ?? null };
  });
}

function toRow(d: DesiredPrompt) {
  return {
    tier: d.tier,
    promptSource: d.promptSource,
    value: d.value,
    sourceRef: d.sourceRef,
    contextLabel: d.contextLabel,
    question: d.question,
    why: d.why,
    payoff: d.payoff,
    targetNode: d.targetNode,
    dedupeKey: d.dedupeKey,
  };
}

/** B3 misalignments flagged on the owner's still-in-play leads (filtered in SQL). */
async function misalignmentRows(owner: string): Promise<MisalignmentRow[]> {
  const leads = await db
    .select({ id: jobLeads.id, title: jobLeads.title, company: jobLeads.company, misalignments: jobLeads.misalignments })
    .from(jobLeads)
    .where(
      and(
        eq(jobLeads.ownerId, owner),
        notInArray(jobLeads.status, ['archived', 'applied']),
        sql`jsonb_array_length(coalesce(${jobLeads.misalignments}, '[]'::jsonb)) > 0`
      )
    );
  const out: MisalignmentRow[] = [];
  for (const l of leads) {
    const mis = (l.misalignments ?? []) as { dimension?: string; detail?: string; severity?: string }[];
    for (const m of mis) {
      if (!m?.dimension) continue;
      out.push({ leadId: l.id, leadTitle: l.title, company: l.company, dimension: m.dimension, detail: m.detail ?? '', severity: m.severity ?? null });
    }
  }
  return out;
}

/**
 * Core/Important requirements to coach against. Once the user has flagged any target
 * roles, demand-pull focuses on those (M1) — flagging a target visibly changes the
 * queue. With no targets flagged yet, fall back to every role still in play so the
 * coach is never empty.
 */
async function targetReqRows(owner: string): Promise<TargetReqRow[]> {
  const rows = await db
    .select({
      leadId: jobLeads.id,
      leadTitle: jobLeads.title,
      company: jobLeads.company,
      status: jobLeads.status,
      isTarget: jobLeads.isTarget,
      requirementId: jobRequirements.id,
      requirement: jobRequirements.requirement,
      rank: jobRequirements.rank,
      initialScore: jobRequirements.initialScore,
      initialMatchStrength: jobRequirements.initialMatchStrength,
    })
    .from(jobRequirements)
    .innerJoin(jobLeads, eq(jobLeads.id, jobRequirements.jobLeadId))
    .where(and(eq(jobRequirements.ownerId, owner), inArray(jobRequirements.rank, ['Core', 'Important'])));

  const inPlay = rows.filter((r) => r.status !== 'archived' && r.status !== 'applied' && !!r.requirement);
  const hasTargets = inPlay.some((r) => r.isTarget);
  return inPlay
    .filter((r) => !hasTargets || r.isTarget)
    .map((r) => ({
      leadId: r.leadId,
      leadTitle: r.leadTitle,
      company: r.company,
      requirementId: r.requirementId,
      requirement: r.requirement as string,
      rank: r.rank,
      initialScore: r.initialScore,
      initialMatchStrength: r.initialMatchStrength,
    }));
}
