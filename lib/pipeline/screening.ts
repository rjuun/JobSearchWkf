/**
 * B1–B6 screening orchestrator. B1 is pure code; B2–B6 emit LLM judgments via
 * runStructured (mock or live); lib/scoring does ALL arithmetic and gates.
 * Persists results to job_leads / job_requirements and records pipeline_runs.
 *
 * Split into two halves (Scoring Phase Redesign) because the workflow is batchy,
 * not one-lead-at-a-time:
 *
 *   runInitialChecks  B1 → B2 → B3   fires automatically at capture; ends at a
 *                                    gate — `selected` (clean) or `scoring_queue`
 *                                    (flagged, waiting on a human).
 *   runScoring        B4 → B5 → B6   fires from the Ready-to-score batch runner,
 *                                    several leads seconds apart so B4–B6's
 *                                    cached system prompts stay warm.
 *   refreshFreshness  B1 only        re-checks the one input that can change
 *                                    after capture (elapsed time).
 *   runScreening      all six        back-compat wrapper for existing callers.
 *
 * The B1–B6 step bodies themselves are unchanged from the single-function
 * version — this is a control-flow split, not a rewrite of step logic.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { jobLeads, jobRequirements } from '../db/schema';
import { recordRun, type StepReport } from './runs';
import { readValuesSummary } from '../profile-context';

export type { StepReport } from './runs';
import { systemPromptFor } from '../prompts';
import { runStructured } from '../llm/client';
import { B2, B3, B4, B5, B6 } from '../llm/schemas';
import {
  freshnessBand,
  saturationBand,
  shouldHold,
  requirementAlignment,
  overallFit,
  recommendationFor,
  matchStrengthForScore,
  matchStrengthToScore,
  round1,
} from '../scoring';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * The screening gate rule, as a pure function so it can be unit-tested without a
 * DB (vitest here runs on plain node — no jsdom, no Postgres). `runInitialChecks`
 * calls exactly this to decide where a lead lands after B2/B3.
 */
export function gateStatusFor(roadblockCount: number, misalignmentCount: number): 'selected' | 'scoring_queue' {
  return roadblockCount === 0 && misalignmentCount === 0 ? 'selected' : 'scoring_queue';
}

/** Owner-scoped lead load shared by all four entry points below. */
async function loadLead(leadId: string, ownerId?: string | null) {
  const [lead] = await db
    .select()
    .from(jobLeads)
    .where(ownerId ? and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, ownerId)) : eq(jobLeads.id, leadId));
  if (!lead) throw new Error('Lead not found');
  return { lead, effectiveOwnerId: ownerId ?? lead.ownerId };
}

/**
 * B1 + B2 + B3 — the automatic half, fired at capture time.
 *
 * Ends at the screening gate: a lead with no roadblocks and no misalignments is
 * auto-advanced to `selected` (nothing for a human to weigh — forcing a click
 * there was manufacturing a decision), anything flagged parks at `scoring_queue`
 * and waits. B1's hold gate is a real short-circuit here: B2/B3 no longer burn
 * two LLM calls on a posting B1 already knows is stale. That's what
 * docs/PIPELINE.md's own G1 diagram has always claimed the code did.
 */
export async function runInitialChecks(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  const { lead, effectiveOwnerId } = await loadLead(leadId, ownerId);
  const jd = lead.jdText ?? '';
  const reports: StepReport[] = [];

  // ── B1 · Freshness & saturation (pure code) ──────────────────────────────
  // shouldHold is computed once, here, and acted on immediately — the old
  // single-function version computed it twice and only wrote the status in B6,
  // which made the gate cosmetic.
  {
    const t = Date.now();
    const fresh = freshnessBand(lead.postedDays);
    const sat = saturationBand(lead.applicantCount);
    const hold = shouldHold(lead.postedDays);
    await db
      .update(jobLeads)
      .set({ freshnessBand: fresh, saturationBand: sat, ...(hold ? { status: 'hold' as const } : {}), updatedAt: new Date() })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    const ms = Date.now() - t;
    await recordRun(leadId, 'B1', 'code', { fresh, sat, hold }, ms, effectiveOwnerId);
    reports.push({ step: 'B1', label: 'Freshness & saturation', status: 'done', model: 'code', ms, summary: `${fresh} · ${sat}${hold ? ' · HOLD (≥60d)' : ''}` });
    if (hold) return reports; // ← the gate. B2/B3 don't run; "Screen anyway" is the manual override.
  }

  // ── B2 · Roadblocks ──────────────────────────────────────────────────────
  let roadblockCount = 0;
  {
    const r = await runStructured({
      step: 'B2',
      model: 'sonnet',
      system: await systemPromptFor('B2', effectiveOwnerId),
      user: `JOB DESCRIPTION:\n${jd || lead.title}`,
      tool: B2.tool,
      zod: B2.zod,
      mock: () => mockRoadblocks(jd, lead.roadblocks ?? []),
      leadId,
      ownerId: effectiveOwnerId,
    });
    await db
      .update(jobLeads)
      .set({ roadblocks: r.data.roadblocks })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    await recordRun(leadId, 'B2', r.model, r.data, r.ms, effectiveOwnerId);
    roadblockCount = r.data.roadblocks.length;
    reports.push({ step: 'B2', label: 'Roadblocks', status: 'done', model: r.model, ms: r.ms, summary: r.data.roadblocks.length ? `${r.data.roadblocks.length} flagged` : 'None' });
  }

  // ── B3 · Misalignments ───────────────────────────────────────────────────
  {
    // B3 weighs the role against the candidate's values & motives, not just the
    // JD — load the Values & Motives summary so the judgment matches the method.
    const valuesSummary = readValuesSummary();
    const r = await runStructured({
      step: 'B3',
      model: 'sonnet',
      system: await systemPromptFor('B3', effectiveOwnerId),
      user:
        `JOB DESCRIPTION:\n${jd || lead.title}\nCITY: ${lead.city ?? 'unknown'}` +
        (valuesSummary ? `\n\nCANDIDATE VALUES & MOTIVES:\n${valuesSummary}` : ''),
      tool: B3.tool,
      zod: B3.zod,
      mock: () => mockMisalignments(jd, lead.city, lead.misalignments ?? []),
      leadId,
      ownerId: effectiveOwnerId,
    });
    await db
      .update(jobLeads)
      .set({ misalignments: r.data.misalignments })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    await recordRun(leadId, 'B3', r.model, r.data, r.ms, effectiveOwnerId);
    reports.push({ step: 'B3', label: 'Misalignments', status: 'done', model: r.model, ms: r.ms, summary: r.data.misalignments.length ? `${r.data.misalignments.length} flagged` : 'None' });

    // ── The screening gate ────────────────────────────────────────────────
    // Clean (nothing flagged by either step) → straight to `selected`, no click.
    // Flagged → `scoring_queue`, which is the only thing the Queue tab shows, so
    // its count is a real "needs you" signal rather than "everything captured".
    await db
      .update(jobLeads)
      .set({ status: gateStatusFor(roadblockCount, r.data.misalignments.length), updatedAt: new Date() })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
  }

  return reports;
}

/**
 * B4 + B5 + B6 — the batch half, driven by the Ready-to-score runner.
 *
 * Marks the lead `screening` first: a transient, per-lead "in flight" marker the
 * enum has carried since 0000 without anything ever setting it. It is also the
 * stuck-lead signal — a hard Vercel kill mid-batch leaves the lead here, and the
 * Ready-to-score tab flags `screening` rows whose `updatedAt` has gone stale.
 * Retrying is safe by construction: B4/B6 overwrite columns and B5 skips
 * re-extraction when job_requirements rows already exist.
 */
export async function runScoring(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  const { lead, effectiveOwnerId } = await loadLead(leadId, ownerId);
  const jd = lead.jdText ?? '';
  const reports: StepReport[] = [];

  // updatedAt is written explicitly — `base` has no $onUpdate, so without this
  // the stuck-lead check below would compare against a timestamp from whenever
  // the row last happened to be touched.
  await db
    .update(jobLeads)
    .set({ status: 'screening', updatedAt: new Date() })
    .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));

  // ── B4 · Skill mapping + JD group + ATS ──────────────────────────────────
  {
    const r = await runStructured({
      step: 'B4',
      model: 'sonnet',
      system: await systemPromptFor('B4', effectiveOwnerId),
      user: `JOB DESCRIPTION:\n${jd || lead.title}`,
      tool: B4.tool,
      zod: B4.zod,
      mock: () => mockSkillMapping(jd, lead),
      leadId,
      ownerId: effectiveOwnerId,
    });
    const ratings = Object.fromEntries(r.data.skills.map((s) => [s.dimension, s.rating]));
    await db
      .update(jobLeads)
      .set({
        skillRatings: ratings,
        jdGroupPrimary: r.data.jdGroupPrimary ?? lead.jdGroupPrimary,
        jdGroupSecondary: r.data.jdGroupSecondary ?? lead.jdGroupSecondary,
        atsSystem: r.data.atsSystem ?? lead.atsSystem,
        // "Key Patterns & CV Tailoring Notes" — B4's process note has always
        // asked the model for this (§B step 3) and the tool schema has always
        // returned it, but the write path dropped it, so key_patterns stayed
        // empty on every lead captured since launch. `?? lead.keyPatterns`
        // preserves a legacy SharePoint-imported value if this call returns null.
        keyPatterns: r.data.notes ?? lead.keyPatterns,
      })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    await recordRun(leadId, 'B4', r.model, r.data, r.ms, effectiveOwnerId);
    reports.push({ step: 'B4', label: 'Skills · JD group · ATS', status: 'done', model: r.model, ms: r.ms, summary: `${r.data.skills.length} rated · ${r.data.jdGroupPrimary ?? '—'}${r.data.atsSystem ? ` · ${r.data.atsSystem}` : ''}` });
  }

  // ── B5 · Extract requirements (reuse seeded if present) ──────────────────
  let requirements = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)));
  {
    const t = Date.now();
    let summary: string;
    let model = 'sonnet (reused)';
    if (requirements.length > 0) {
      summary = `${requirements.length} requirements (kept)`;
    } else {
      const r = await runStructured({
        step: 'B5',
        model: 'sonnet',
        system: await systemPromptFor('B5', effectiveOwnerId),
        user: `JOB DESCRIPTION:\n${jd || lead.title}`,
        tool: B5.tool,
        zod: B5.zod,
        mock: () => mockRequirements(jd),
        leadId,
        ownerId: effectiveOwnerId,
      });
      model = r.model;
      if (r.data.requirements.length > 0) {
        requirements = await db
          .insert(jobRequirements)
          .values(
            r.data.requirements.map((req) => ({
              ownerId: effectiveOwnerId ?? undefined,
              jobLeadId: leadId,
              leadTitle: lead.title,
              requirementOrder: req.order,
              rank: req.rank,
              requirementGroup: req.rank,
              requirement: req.requirement,
              description: req.description ?? null,
              skills: req.skills,
            }))
          )
          .returning();
      }
      summary = `${requirements.length} extracted`;
    }
    const ms = Date.now() - t;
    await recordRun(leadId, 'B5', model, { count: requirements.length }, ms, effectiveOwnerId);
    reports.push({ step: 'B5', label: 'Extract requirements', status: 'done', model, ms, summary });
  }

  // ── B6 · Role fit (Opus judgments → deterministic rollup) ────────────────
  {
    const r = await runStructured({
      step: 'B6',
      model: 'opus',
      system: await systemPromptFor('B6', effectiveOwnerId),
      user: `JOB DESCRIPTION:\n${jd || lead.title}\n\nREQUIREMENTS:\n${requirements
        .map((q, i) => `${i + 1}. [${q.rank}] ${q.requirement}`)
        .join('\n')}\n\nFor each requirement, set "order" to its number above.`,
      tool: B6.tool,
      zod: B6.zod,
      mock: () => mockRoleFit(lead.skillRatings ?? {}, lead.atsSystem, requirements),
      leadId,
      ownerId: effectiveOwnerId,
    });

    // Map per-requirement judgments back to rows by the stable `order` key
    // (robust if the LLM reorders), falling back to text then index.
    const byOrder = new Map<number, (typeof r.data.requirements)[number]>();
    for (const j of r.data.requirements) if (j.order != null) byOrder.set(j.order, j);
    const perReq = requirements.map((q, i) => {
      const j =
        byOrder.get(i + 1) ??
        r.data.requirements.find((x) => x.requirement === q.requirement) ??
        r.data.requirements[i];
      const score = j?.score ?? 6;
      return { row: q, score, matchStrength: j?.matchStrength ?? matchStrengthForScore(score) };
    });
    for (const p of perReq) {
      await db
        .update(jobRequirements)
        .set({ initialScore: p.score, initialMatchStrength: p.matchStrength })
        .where(and(eq(jobRequirements.id, p.row.id), eq(jobRequirements.ownerId, effectiveOwnerId)));
    }

    // ALL arithmetic here, never the LLM.
    const reqAlignment = requirementAlignment(perReq.map((p) => ({ score: p.score, rank: p.row.rank })));
    const dims = { relevance: r.data.relevance, seniority: r.data.seniority, impact: r.data.impact, reqAlignment, ats: r.data.ats };
    const overall = overallFit(dims);
    const recommendation = recommendationFor(overall);
    const hold = shouldHold(lead.postedDays);

    await db
      .update(jobLeads)
      .set({
        scoreRelevance: dims.relevance,
        scoreSeniority: dims.seniority,
        scoreImpact: dims.impact,
        scoreReqAlignment: reqAlignment,
        scoreAts: dims.ats,
        overallFitScore: overall,
        recommendation,
        bulletBankVersion: '2026-06',
        status: hold ? 'hold' : 'screened',
      })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));

    await recordRun(leadId, 'B6', r.model, { ...dims, overall, recommendation }, r.ms, effectiveOwnerId);
    reports.push({ step: 'B6', label: 'Role fit score', status: 'done', model: r.model, ms: r.ms, summary: `${overall.toFixed(1)} / 10 · ${recommendation}` });
  }

  return reports;
}

/**
 * B1-only refresh — deliberately NOT the same as re-running the whole screen.
 * Only B1's inputs (elapsed time against the hold threshold) can meaningfully
 * change after capture; B2–B6 are judgments over static JD text, so re-running
 * them just re-spends LLM calls to get the same answer back.
 *
 * A status change is forced only while the lead is still pre-decision
 * (`scoring_queue`, or `captured`/`hold` from an earlier pass). A lead already
 * `selected`/`screening`/`screened` or further along keeps whatever decision was
 * taken — refreshing updates the freshness badge, it never silently overturns a
 * human call.
 */
export async function refreshFreshness(leadId: string, ownerId?: string | null): Promise<StepReport> {
  const { lead, effectiveOwnerId } = await loadLead(leadId, ownerId);
  const t = Date.now();
  const fresh = freshnessBand(lead.postedDays);
  const sat = saturationBand(lead.applicantCount);
  const hold = shouldHold(lead.postedDays);

  const preDecision = lead.status === 'scoring_queue' || lead.status === 'captured' || lead.status === 'hold';
  const nextStatus = hold && preDecision && lead.status !== 'hold' ? ('hold' as const) : null;

  await db
    .update(jobLeads)
    .set({ freshnessBand: fresh, saturationBand: sat, ...(nextStatus ? { status: nextStatus } : {}), updatedAt: new Date() })
    .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));

  const ms = Date.now() - t;
  await recordRun(leadId, 'B1', 'code', { fresh, sat, hold, refreshed: true, statusChanged: nextStatus }, ms, effectiveOwnerId);
  return {
    step: 'B1',
    label: 'Freshness & saturation',
    status: 'done',
    model: 'code',
    ms,
    summary: `${fresh} · ${sat}${hold ? ' · HOLD (≥60d)' : ''}${nextStatus ? ' · moved to hold' : ''}`,
  };
}

/**
 * Back-compat wrapper: unchanged call sites (scripts/batch-screen.ts,
 * scripts/verify-screening.ts, the board's manual "Screen" action) keep working
 * and still run B1→B6 in one go.
 *
 * Note the B1 gate now genuinely short-circuits, so a held lead returns one
 * report instead of six — that's the intended behaviour change, matching
 * docs/PIPELINE.md's G1 diagram.
 */
export async function runScreening(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  const initial = await runInitialChecks(leadId, ownerId);
  // B2 present ⇒ the B1 gate let it through. (Checking for B1 instead would
  // always match — B1 runs on every path.)
  if (!initial.some((r) => r.step === 'B2')) return initial;
  const scoring = await runScoring(leadId, ownerId);
  return [...initial, ...scoring];
}

// ── Mock heuristics (deterministic; grounded in the JD text + seeded data) ───
type LeadRow = typeof jobLeads.$inferSelect;
type ReqRow = typeof jobRequirements.$inferSelect;

function mockRoadblocks(jd: string, seeded: { dimension: string; detail: string }[]) {
  const t = jd.toLowerCase();
  if (!t) return { roadblocks: seeded };
  const out: { dimension: string; detail: string }[] = [];
  if (/(native|muttersprache|verhandlungssicher|fluent)\b[^.]*\b(german|deutsch)|(german|deutsch)[^.]*\b(native|fluent|c2)/.test(t))
    out.push({ dimension: 'Language', detail: 'Native/fluent German implied' });
  if (/\bsap\b/.test(t)) out.push({ dimension: 'Technical', detail: 'SAP required' });
  if (/salesforce/.test(t)) out.push({ dimension: 'Technical', detail: 'Salesforce required' });
  if (/\bcfa\b/.test(t)) out.push({ dimension: 'Certification', detail: 'CFA required' });
  if (/\b(cpa|acca|cima)\b/.test(t)) out.push({ dimension: 'Certification', detail: 'Accounting certification required' });
  return { roadblocks: out };
}

function mockMisalignments(jd: string, city: string | null, seeded: { dimension: string; detail: string }[]) {
  const t = jd.toLowerCase();
  if (!t) return { misalignments: seeded };
  const out: { dimension: string; detail: string; severity?: string }[] = [];
  if (/on-?site only|fully on-?site|5 days (a week )?in (the )?office/.test(t)) out.push({ dimension: 'Culture', detail: 'On-site only' });
  if (/always-?on|fast-?paced|hard-?charging/.test(t)) out.push({ dimension: 'Culture', detail: 'High-intensity language' });
  const primary = ['vienna', 'amsterdam', 'copenhagen', 'london', 'milan'];
  if (city && !primary.includes(city.toLowerCase())) out.push({ dimension: 'City', detail: `${city} (secondary preference)` });
  return { misalignments: out };
}

function detectAts(jd: string): string | null {
  const t = jd.toLowerCase();
  if (/workday|myworkdayjobs/.test(t)) return 'Workday';
  if (/greenhouse/.test(t)) return 'Greenhouse';
  if (/smartrecruiters/.test(t)) return 'SmartRecruiters';
  if (/successfactors/.test(t)) return 'SuccessFactors';
  if (/lever\.co|jobs\.lever/.test(t)) return 'Lever';
  return null;
}

function mockSkillMapping(jd: string, lead: LeadRow) {
  const ratings = (lead.skillRatings ?? {}) as Record<string, number>;
  const skills = Object.entries(ratings).map(([dimension, rating]) => ({ dimension, rating }));
  return {
    skills,
    jdGroupPrimary: lead.jdGroupPrimary ?? null,
    jdGroupSecondary: lead.jdGroupSecondary ?? null,
    atsSystem: lead.atsSystem ?? detectAts(jd),
    notes: null,
  };
}

function mockRequirements(jd: string) {
  const lines = jd
    .split('\n')
    .map((l) => l.replace(/^[\s•*\-–—]+/, '').trim())
    .filter((l) => l.length > 25 && l.length < 240 && /[a-z]/.test(l));
  const picked = lines.slice(0, 12);
  return {
    requirements: picked.map((requirement, i) => ({
      order: i + 1,
      requirement: requirement.slice(0, 90),
      description: requirement,
      rank: i < 4 ? 'Core' : i < 8 ? 'Important' : 'Nice-to-Have',
      skills: [],
    })),
  };
}

function mockRoleFit(ratings: Record<string, number>, ats: string | null, reqs: ReqRow[]) {
  const ratingScores = Object.values(ratings).map((r) => (r === 1 ? 9 : r === 2 ? 7 : 5));
  const relevance = round1(ratingScores.length ? avg(ratingScores) : 6.5);
  const hasLeadership = Object.entries(ratings).some(([k, v]) => /leadership/i.test(k) && v <= 2);
  const seniority = hasLeadership ? 8 : 6.8;
  return {
    relevance,
    seniority,
    impact: 7,
    ats: ats ? 7 : 6,
    requirements: reqs.map((q, i) => {
      const s = q.initialScore ?? matchStrengthToScore(q.initialMatchStrength) ?? 6;
      return { order: i + 1, requirement: q.requirement, score: s, matchStrength: matchStrengthForScore(s) };
    }),
    summary: 'Mock scoring derived from seeded skill ratings and requirement strengths.',
  };
}
