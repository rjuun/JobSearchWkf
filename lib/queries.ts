/** Typed read helpers over the DB (server-side). Every read is scoped to the logged-in user. */
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from './db';
import {
  jobLeads,
  jobRequirements,
  requirementTailoring,
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
  onboardingState,
  ciInitiatives,
  accuracyTips,
  llmCalls,
  pipelineRuns,
  applications,
} from './db/schema';
import { currentOwnerId } from './auth';
import { activationMetrics } from './activation';
import { EMPTY_TARGETS, evidenceTokens, graphCoversRequirement } from './career-graph';
import type { CareerGraph, TargetCoverage } from './career-graph';
import {
  computeTriage,
  triageReasons,
  FRESH_FACTOR,
  SAT_FACTOR,
  type Triage,
  type TriageLead,
} from './triage';

export async function listLeads() {
  const owner = await currentOwnerId();
  return db
    .select()
    .from(jobLeads)
    .where(eq(jobLeads.ownerId, owner))
    .orderBy(sql`${jobLeads.overallFitScore} desc nulls last`, asc(jobLeads.title));
}

/** A single lead — scoped to the owner so one user can't load another's lead by id. */
export async function getLead(id: string) {
  const owner = await currentOwnerId();
  const [lead] = await db.select().from(jobLeads).where(and(eq(jobLeads.id, id), eq(jobLeads.ownerId, owner)));
  return lead ?? null;
}

export async function getRequirements(leadId: string) {
  const owner = await currentOwnerId();
  return db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, owner)))
    .orderBy(asc(jobRequirements.requirementOrder));
}

export async function getTailoring(leadId: string) {
  const owner = await currentOwnerId();
  return db
    .select()
    .from(requirementTailoring)
    .where(and(eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, owner)));
}

/** Pipeline runs for a lead, newest first, scoped to the logged-in user. */
export async function getPipelineRuns(leadId: string) {
  const owner = await currentOwnerId();
  return db
    .select()
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.jobLeadId, leadId), eq(pipelineRuns.ownerId, owner)))
    .orderBy(desc(pipelineRuns.finishedAt), desc(pipelineRuns.createdAt));
}

export async function getProfile() {
  const owner = await currentOwnerId();
  const [p] = await db.select().from(profiles).where(eq(profiles.id, owner));
  return p ?? null;
}

/** The whole evidence store for the logged-in user, ordered by ref_code. Used by /profile. */
export async function getCareerGraph(): Promise<CareerGraph> {
  return getCareerGraphFor(await currentOwnerId());
}

/** Owner-scoped graph loader — usable outside a request (jobs, tests, generators). */
export async function getCareerGraphFor(owner: string): Promise<CareerGraph> {
  const [profileRows, pos, st, actions, results, competences, attributes, resp, edu, langs, bullets, skills] =
    await Promise.all([
      db.select().from(profiles).where(eq(profiles.id, owner)),
      db.select().from(positions).where(eq(positions.ownerId, owner)).orderBy(asc(positions.refCode)),
      db.select().from(stars).where(eq(stars.ownerId, owner)).orderBy(asc(stars.refCode)),
      db.select().from(starActions).where(eq(starActions.ownerId, owner)).orderBy(asc(starActions.refCode)),
      db.select().from(starResults).where(eq(starResults.ownerId, owner)).orderBy(asc(starResults.refCode)),
      db.select().from(starCompetences).where(eq(starCompetences.ownerId, owner)),
      db.select().from(starAttributes).where(eq(starAttributes.ownerId, owner)),
      db.select().from(responsibilities).where(eq(responsibilities.ownerId, owner)).orderBy(asc(responsibilities.refCode)),
      db.select().from(education).where(eq(education.ownerId, owner)).orderBy(asc(education.refCode)),
      db.select().from(languages).where(eq(languages.ownerId, owner)).orderBy(asc(languages.refCode)),
      db.select().from(bulletBank).where(eq(bulletBank.ownerId, owner)).orderBy(asc(bulletBank.refCode)),
      db.select().from(skillsMaster).where(eq(skillsMaster.ownerId, owner)).orderBy(asc(skillsMaster.refCode)),
    ]);
  const graph: CareerGraph = {
    profile: profileRows[0] ?? null,
    positions: pos,
    stars: st,
    actions,
    results,
    competences,
    attributes,
    responsibilities: resp,
    education: edu,
    languages: langs,
    bullets,
    skills,
    targets: EMPTY_TARGETS,
  };
  // Coverage is recomputed against THIS graph, so newly-coached evidence counts immediately.
  graph.targets = await getTargetCoverage(owner, evidenceTokens(graph));
  return graph;
}

/**
 * Coverage of the Core/Important requirements on the roles the user has flagged as targets
 * (M1). A requirement is "covered" when the initial screening judged it not-weak (score ≥ 5,
 * non-weak strength) OR the current graph now evidences it (`graphCoversRequirement`). The
 * OR means coaching a gap raises coverage live, while the screening verdict stays a floor —
 * so the relevancy dimension of the strength meter actually compounds. Pass the evidence
 * tokens of the graph being scored.
 */
export async function getTargetCoverage(owner: string, tokens: Set<string>): Promise<TargetCoverage> {
  const rows = await db
    .select({
      leadId: jobLeads.id,
      requirement: jobRequirements.requirement,
      initialScore: jobRequirements.initialScore,
      initialMatchStrength: jobRequirements.initialMatchStrength,
    })
    .from(jobLeads)
    .innerJoin(jobRequirements, eq(jobRequirements.jobLeadId, jobLeads.id))
    .where(
      and(
        eq(jobLeads.ownerId, owner),
        eq(jobLeads.isTarget, true),
        // Match the coach: a target you've archived or already applied to no longer
        // inflates the relevancy denominator / "still to prove" headroom.
        notInArray(jobLeads.status, ['archived', 'applied']),
        inArray(jobRequirements.rank, ['Core', 'Important'])
      )
    );

  const leads = new Set<string>();
  let covered = 0;
  for (const r of rows) {
    leads.add(r.leadId);
    const notWeakAtScreening =
      (r.initialScore ?? 0) >= 5 && !['Weak', 'No Match'].includes(r.initialMatchStrength ?? '');
    const nowCovered = !!r.requirement && graphCoversRequirement(r.requirement, tokens);
    if (notWeakAtScreening || nowCovered) covered++;
  }
  return { flaggedLeads: leads.size, requirements: rows.length, covered, open: Math.max(0, rows.length - covered) };
}

/** The onboarding (import) state for the logged-in user, if any. */
export async function getOnboardingState() {
  const owner = await currentOwnerId();
  const [row] = await db.select().from(onboardingState).where(eq(onboardingState.ownerId, owner));
  return row ?? null;
}

export async function leadCountsByStatus(owner: string) {
  return db
    .select({ status: jobLeads.status, n: sql<number>`count(*)::int` })
    .from(jobLeads)
    .where(eq(jobLeads.ownerId, owner))
    .groupBy(jobLeads.status);
}

export async function listCiInitiatives() {
  const owner = await currentOwnerId();
  return db.select().from(ciInitiatives).where(eq(ciInitiatives.ownerId, owner)).orderBy(asc(ciInitiatives.title));
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

/** Everything the dashboard needs, in one parallel fetch — all scoped to the user. */
export async function getDashboardData() {
  const owner = await currentOwnerId();
  const [statusRows, scoreRows, ci, tips, calls, runsCount] = await Promise.all([
    leadCountsByStatus(owner),
    db.select({ score: jobLeads.overallFitScore }).from(jobLeads).where(eq(jobLeads.ownerId, owner)),
    db.select().from(ciInitiatives).where(eq(ciInitiatives.ownerId, owner)).orderBy(asc(ciInitiatives.status), asc(ciInitiatives.title)),
    db.select().from(accuracyTips).where(eq(accuracyTips.ownerId, owner)).orderBy(desc(accuracyTips.createdAt)),
    db.select().from(llmCalls).where(eq(llmCalls.ownerId, owner)),
    db.select({ n: sql<number>`count(*)::int` }).from(pipelineRuns).where(eq(pipelineRuns.ownerId, owner)),
  ]);

  const buckets = { Proceed: 0, Borderline: 0, Hold: 0, 'Not recommended': 0, Unscored: 0 };
  for (const { score } of scoreRows) {
    if (score == null) buckets.Unscored++;
    else if (score >= 7) buckets.Proceed++;
    else if (score >= 5.5) buckets.Borderline++;
    else if (score >= 4) buckets.Hold++;
    else buckets['Not recommended']++;
  }

  const tokens = calls.reduce((a, c) => a + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0);
  const liveCalls = calls.filter((c) => c.mode === 'live').length;
  const scored = scoreRows.filter((r) => r.score != null) as { score: number }[];
  const avgFit = scored.length ? Math.round((scored.reduce((a, r) => a + r.score, 0) / scored.length) * 10) / 10 : null;

  return {
    statusRows,
    totalLeads: scoreRows.length,
    avgFit,
    buckets,
    ci,
    tips,
    activation: await activationMetrics(owner),
    usage: { calls: calls.length, liveCalls, tokens, runs: runsCount[0]?.n ?? 0 },
  };
}

/** The user's accuracy-improvement notes (the "improve" loop), newest first. */
export async function listTips() {
  const owner = await currentOwnerId();
  return db
    .select()
    .from(accuracyTips)
    .where(eq(accuracyTips.ownerId, owner))
    .orderBy(desc(accuracyTips.createdAt));
}

/** Open accuracy flags raised against a specific lead — shown back in its workspace. */
export async function tipsForLead(leadId: string) {
  const owner = await currentOwnerId();
  return db
    .select()
    .from(accuracyTips)
    .where(
      and(
        eq(accuracyTips.ownerId, owner),
        eq(accuracyTips.jobLeadId, leadId),
        eq(accuracyTips.resolved, false)
      )
    )
    .orderBy(desc(accuracyTips.createdAt));
}

// ── "This week" picks (Additive Plan · A3) ──────────────────────────────────
// A derived triage lens that sits *above* the full board table without replacing
// it: compose the three signals B1 already captures — fit × freshness ×
// saturation — into a single weight and surface the two leads most worth acting
// on now. Pure computation over listLeads(); no new data, no new writes.
export type WeekPick = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  status: string;
  overallFitScore: number | null;
  reasons: string[];
};

/**
 * The top `limit` leads by fit × freshness × saturation (the A3 strip). Shares the
 * factor maps + reason phrasing with the full R5 triage so the two never disagree.
 * Returns [] when there aren't enough scored, still-actionable leads for "picking"
 * to be real narrowing — so the strip only appears once it's doing work.
 */
export async function thisWeekPicks(limit = 2): Promise<WeekPick[]> {
  const leads = await listLeads();
  const candidates = leads.filter(
    (l) => l.overallFitScore != null && !['applied', 'archived', 'hold'].includes(l.status)
  );
  if (candidates.length < 3) return [];
  const ranked = candidates
    .map((l) => {
      const fit = l.overallFitScore ?? 0;
      const fresh = FRESH_FACTOR[l.freshnessBand ?? ''] ?? 0.6;
      const sat = SAT_FACTOR[l.saturationBand ?? ''] ?? 0.7;
      return { l, weight: (fit / 10) * fresh * sat };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
  return ranked.map(({ l }) => ({
    id: l.id,
    title: l.title,
    company: l.company,
    city: l.city,
    status: l.status,
    overallFitScore: l.overallFitScore,
    reasons: triageReasons(l.overallFitScore ?? 0, l.freshnessBand, l.saturationBand, 0),
  }));
}

// ── The Weekly Triage (R5 · full #6a) ───────────────────────────────────────
// The whole judged queue, capacity-trimmed, with auto-held stale leads. Pure
// derivation (lib/triage) over listLeads() + the per-owner capacity setting; no
// new writes, and auto-hold is a derived band (never a destructive status change).

/** How many tailorings/week this owner can do. Defensive: default 2 if the column lags. */
export async function getWeeklyCapacity(): Promise<number> {
  const owner = await currentOwnerId();
  try {
    const [p] = await db.select({ cap: profiles.weeklyCapacity }).from(profiles).where(eq(profiles.id, owner));
    return p?.cap && p.cap > 0 ? p.cap : 2;
  } catch {
    return 2;
  }
}

/** Set the per-owner weekly capacity (clamped to a sane 1–7). Best-effort. */
export async function setWeeklyCapacity(n: number): Promise<void> {
  const owner = await currentOwnerId();
  const cap = Math.max(1, Math.min(7, Math.floor(n)));
  try {
    await db.update(profiles).set({ weeklyCapacity: cap, updatedAt: new Date() }).where(eq(profiles.id, owner));
  } catch {
    /* best-effort setting */
  }
}

export async function weeklyTriage(): Promise<Triage> {
  const [leads, capacity] = await Promise.all([listLeads(), getWeeklyCapacity()]);
  const inputs: TriageLead[] = leads.map((l) => ({
    id: l.id,
    title: l.title,
    company: l.company,
    city: l.city,
    status: l.status,
    overallFitScore: l.overallFitScore,
    postedDays: l.postedDays,
    applicantCount: l.applicantCount,
    freshnessBand: l.freshnessBand,
    saturationBand: l.saturationBand,
    flagCount:
      ((l.roadblocks ?? []) as unknown[]).length + ((l.misalignments ?? []) as unknown[]).length,
  }));
  return computeTriage(inputs, capacity);
}

// ── Sourcing Compass (Additive Plan · B4) ───────────────────────────────────
// Rank the free-text sources the user actually captures by the average fit they
// produce, so an alert or recruiter that only yields weak matches becomes visible
// and retireable. Pure aggregate over the leads; archived leads excluded.
export type SourceRow = { source: string; count: number; scored: number; avgFit: number | null };

export async function sourcingCompass(): Promise<SourceRow[]> {
  const owner = await currentOwnerId();
  const rows = await db
    .select({ source: jobLeads.source, score: jobLeads.overallFitScore, status: jobLeads.status })
    .from(jobLeads)
    .where(eq(jobLeads.ownerId, owner));
  const map = new Map<string, { count: number; sum: number; scored: number }>();
  for (const r of rows) {
    if (r.status === 'archived') continue;
    const key = (r.source ?? '').trim() || 'Unknown';
    const m = map.get(key) ?? { count: 0, sum: 0, scored: 0 };
    m.count++;
    if (r.score != null) {
      m.sum += r.score;
      m.scored++;
    }
    map.set(key, m);
  }
  const out: SourceRow[] = [...map.entries()].map(([source, m]) => ({
    source,
    count: m.count,
    scored: m.scored,
    avgFit: m.scored ? Math.round((m.sum / m.scored) * 10) / 10 : null,
  }));
  // Rank by avg fit produced (nulls last), then by volume.
  out.sort((a, b) => (b.avgFit ?? -1) - (a.avgFit ?? -1) || b.count - a.count);
  // Only meaningful once at least one lead carries a real (non-Unknown) source.
  if (out.every((r) => r.source === 'Unknown')) return [];
  return out;
}

// ── Coverage Matrix (Additive Plan · B3) ────────────────────────────────────
// Per-target, per-requirement coverage — the same not-weak-at-screening OR
// now-evidenced test the strength meter's relevancy uses (getTargetCoverage),
// exploded into a grid so gaps are addressable one cell at a time (each links to
// the coach). An additional lens beside the meter, never a replacement.
export type CoverageCell = { requirement: string; rank: string | null; covered: boolean };
export type CoverageRow = {
  leadId: string;
  title: string;
  company: string | null;
  covered: number;
  total: number;
  cells: CoverageCell[];
};

export async function targetCoverageMatrix(): Promise<CoverageRow[]> {
  const owner = await currentOwnerId();
  const graph = await getCareerGraphFor(owner);
  const tokens = evidenceTokens(graph);
  const rows = await db
    .select({
      leadId: jobLeads.id,
      title: jobLeads.title,
      company: jobLeads.company,
      requirement: jobRequirements.requirement,
      rank: jobRequirements.rank,
      initialScore: jobRequirements.initialScore,
      initialMatchStrength: jobRequirements.initialMatchStrength,
    })
    .from(jobLeads)
    .innerJoin(jobRequirements, eq(jobRequirements.jobLeadId, jobLeads.id))
    .where(
      and(
        eq(jobLeads.ownerId, owner),
        eq(jobLeads.isTarget, true),
        notInArray(jobLeads.status, ['archived', 'applied']),
        inArray(jobRequirements.rank, ['Core', 'Important'])
      )
    )
    .orderBy(asc(jobLeads.title), asc(jobRequirements.requirementOrder));

  const byLead = new Map<string, CoverageRow>();
  for (const r of rows) {
    const row = byLead.get(r.leadId) ?? { leadId: r.leadId, title: r.title, company: r.company, covered: 0, total: 0, cells: [] };
    const notWeak = (r.initialScore ?? 0) >= 5 && !['Weak', 'No Match'].includes(r.initialMatchStrength ?? '');
    const nowCovered = !!r.requirement && graphCoversRequirement(r.requirement, tokens);
    const covered = notWeak || nowCovered;
    row.cells.push({ requirement: r.requirement, rank: r.rank, covered });
    row.total++;
    if (covered) row.covered++;
    byLead.set(r.leadId, row);
  }
  return [...byLead.values()];
}

// ── Returns (Additive Plan · B2) ────────────────────────────────────────────
// The applications the user has actually sent (or downloaded a CV for), with
// their logged status — the raw material for the Returns panel + its nudge.
export type ApplicationRow = {
  id: string;
  leadId: string;
  title: string;
  company: string | null;
  status: string | null;
  appliedAt: Date | null;
  outcomeNotes: string | null;
};

export async function listApplications(): Promise<ApplicationRow[]> {
  const owner = await currentOwnerId();
  return db
    .select({
      id: applications.id,
      leadId: applications.jobLeadId,
      title: jobLeads.title,
      company: jobLeads.company,
      status: applications.status,
      appliedAt: applications.appliedAt,
      outcomeNotes: applications.outcomeNotes,
    })
    .from(applications)
    .innerJoin(jobLeads, eq(jobLeads.id, applications.jobLeadId))
    .where(eq(applications.ownerId, owner))
    .orderBy(desc(applications.appliedAt));
}

/** Map of leadId → requirement count for the user's leads, for the lead board. */
export async function requirementCountsByLead(): Promise<Map<string, number>> {
  const owner = await currentOwnerId();
  const rows = await db
    .select({ leadId: jobRequirements.jobLeadId, n: sql<number>`count(*)::int` })
    .from(jobRequirements)
    .where(eq(jobRequirements.ownerId, owner))
    .groupBy(jobRequirements.jobLeadId);
  return new Map(rows.map((r) => [r.leadId, r.n]));
}
