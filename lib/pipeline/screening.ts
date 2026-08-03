/**
 * B1–B6 screening orchestrator. B1 is pure code; B2–B6 emit LLM judgments via
 * runStructured (mock or live); lib/scoring does ALL arithmetic and gates.
 * Persists results to job_leads / job_requirements and records pipeline_runs.
 *
 * Split into two halves (Scoring Phase Redesign) because the workflow is batchy,
 * not one-lead-at-a-time:
 *
 *   runInitialChecks  B1 → B2 → B3 → B4  fires automatically at capture; ends at a
 *                                    gate — `selected` (clean) or `scoring_queue`
 *                                    (flagged, waiting on a human).
 *   runScoring        B5 → B6        fires from the Ready-to-score batch runner,
 *                                    several leads seconds apart so B5/B6's
 *                                    cached system prompts stay warm.
 *   refreshFreshness  B1 only        re-checks the one input that can change
 *                                    after capture (elapsed time).
 *   runScreening      all six        back-compat wrapper for existing callers.
 *
 * ── B-phase reorder (CI · Lead Page as Pipeline Canvas §2.1) ────────────────
 * The step CODES moved; the step bodies did not. Extraction is now B2 and runs
 * first, roadblocks/misalignments/areas-of-expertise each shifted down one:
 *
 *   old B5 Extract requirements  → B2   (moved INTO the automatic half)
 *   old B2 Roadblocks            → B3
 *   old B3 Misalignments         → B4
 *   old B4 Areas of Expertise    → B5   (stays in the batch half)
 *
 * Why extraction moved to the front: B5 is *called* "Translate Requirements to
 * Areas of Expertise" and used to run before any requirements existed, so it
 * necessarily translated raw JD text — title and execution order contradicted
 * each other. And §2.5 lets a roadblock name the requirement row it blocks, which
 * is impossible if the rows don't exist yet.
 *
 * Why the automatic half grew by one call rather than shrinking to B1 only
 * (§4.2, superseding the earlier on-demand-everything decision): the two LLM
 * calls in this half already run in production on every capture; adding Extract
 * Requirements is ~+$2/month at 160 captures, and it makes the Map's requirement
 * side populate at capture with no manual trigger — which is the point of §2.4.
 * `gateStatusFor` is unchanged and still non-abandoning: flagged leads park for a
 * human, they are never dropped.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { bulletBank, education, jobLeads, jobRequirements, languages, requirementEvidence } from '../db/schema';
import { recordRun, type StepReport } from './runs';
import { readValuesSummary } from '../profile-context';
import { normalizeCvPosition } from '../cv-slots';

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

/** "" and "   " are what a complete strict `required` list produces for "nothing to say" — store null. */
const nullIfBlank = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

/**
 * The screening gate rule, as a pure function so it can be unit-tested without a
 * DB (vitest here runs on plain node — no jsdom, no Postgres). `runInitialChecks`
 * calls exactly this to decide where a lead lands after B3/B4 (the roadblock and
 * misalignment steps — they were B2/B3 before the reorder).
 *
 * Deliberately unchanged by the B-phase reorder (CI §4.4, §4.2). Two things this
 * must keep doing: (1) never auto-abandon — a flagged lead parks at
 * `scoring_queue` for a human call, it is not dropped; (2) treat misalignments as
 * a park, not a kill. `B4. Identify Misalignments` says twice in bold that a
 * misalignment flag does NOT stop the process, and PIPELINE.md calls its output
 * "flags (not blockers)". Turning either into a hard gate would silently kill
 * viable leads that today reach the user's desk.
 */
export function gateStatusFor(roadblockCount: number, misalignmentCount: number): 'selected' | 'scoring_queue' {
  return roadblockCount === 0 && misalignmentCount === 0 ? 'selected' : 'scoring_queue';
}

/**
 * ── B6's evidence side (CI · B6 Never Receives the Master Bullet Bank) ───────
 *
 * One candidate B6 may cite, keyed by the same stable ref code the Career Graph
 * uses everywhere else, so the model never has to quote free text to identify a
 * bullet — and so a citation can be verified against the bank rather than trusted.
 */
export type B6Evidence = {
  ref: string;
  kind: 'Bullet' | 'Education' | 'Language';
  text: string;
  tags: string[];
  cvPosition: string | null;
};

/**
 * The provenance stamp `job_leads.bullet_bank_version` is supposed to carry.
 *
 * It was the literal `'2026-06'` until this CI: a hardcoded claim that a specific
 * bank version informed the score, written on every lead by a step that had never
 * been sent a bank at all. Derived from the rows actually sent instead — `null`
 * when the bank is empty, because "no bank was consulted" is a fact worth being
 * able to read back off the row.
 */
export function bulletBankVersionOf(rows: { version: string | null }[]): string | null {
  if (rows.length === 0) return null;
  const versions = [...new Set(rows.map((r) => (r.version ?? '').trim()).filter(Boolean))].sort();
  // Rows exist but none is stamped — still not the same as no bank at all.
  return versions.length === 0 ? 'unversioned' : versions.join('+');
}

/**
 * Everything B6's note §A/§B.1.2 says it scores against: the Master Bullet Bank as
 * the primary reference, plus education and languages, which the note names
 * explicitly ("when relevant, also reference tbl_Education and tbl_Language").
 *
 * Deliberately NOT the whole Career Graph — responsibilities, STAR actions and
 * results, competences and skills are C2's scope (§2.0), and widening B6 to them
 * would erase the distinction between the initial screen and the tailoring pass.
 */
export async function gatherB6Evidence(ownerId: string): Promise<{ items: B6Evidence[]; bankVersion: string | null }> {
  const [bank, edu, langs] = await Promise.all([
    db.select().from(bulletBank).where(eq(bulletBank.ownerId, ownerId)).orderBy(asc(bulletBank.refCode)),
    db.select().from(education).where(eq(education.ownerId, ownerId)).orderBy(asc(education.refCode)),
    db.select().from(languages).where(eq(languages.ownerId, ownerId)).orderBy(asc(languages.refCode)),
  ]);
  const items: B6Evidence[] = [];
  for (const b of bank) {
    if (!b.refCode || !b.text) continue;
    items.push({ ref: b.refCode, kind: 'Bullet', text: b.text, tags: b.tags ?? [], cvPosition: normalizeCvPosition(b.cvPosition) });
  }
  for (const e of edu) {
    if (!e.refCode) continue;
    items.push({
      ref: e.refCode,
      kind: 'Education',
      text: [e.qualification, e.institution, e.year].filter(Boolean).join(', '),
      tags: e.type ? [e.type] : [],
      cvPosition: null,
    });
  }
  for (const l of langs) {
    if (!l.refCode || !l.language) continue;
    items.push({ ref: l.refCode, kind: 'Language', text: `${l.language} — ${l.cefrLevel ?? 'level unstated'}`, tags: [], cvPosition: null });
  }
  return { items, bankVersion: bulletBankVersionOf(bank) };
}

/** The evidence listing exactly as B6 sees it. Extracted so a test can assert every ref reaches the model. */
export function renderB6Evidence(items: B6Evidence[]): string {
  if (items.length === 0) {
    return (
      'CANDIDATE EVIDENCE: none on file — this owner has no Master Bullet Bank, education or language records.\n' +
      'You therefore have nothing to match requirements against: mark every requirement "No Match", leave ' +
      '"evidenceRefs" empty, and say in "gaps" that no evidence bank was available. Do not invent evidence.'
    );
  }
  return (
    'CANDIDATE EVIDENCE — the Master Bullet Bank plus education and languages. Cite by EXACT ref code:\n' +
    items
      .map((e) => `[${e.ref}] (${e.kind})${e.tags.length ? ` [${e.tags.join(', ')}]` : ''} ${e.text}`)
      .join('\n')
  );
}

/**
 * Resolve the refs B6 cited into rows for `requirement_evidence`.
 *
 * Two things this does that a straight map would not. It drops refs that aren't in
 * the listing the model was given — a code that isn't in the bank is a fabricated
 * citation, and NON_NEGOTIABLES says we never let one through. And it de-duplicates
 * per requirement, so a model that names the same bullet twice yields one lane item
 * rather than two identical ones stacked in the same slot.
 */
export function resolveEvidenceLinks<TReq extends { id: string }>(
  perReq: { row: TReq; refs: string[]; note: string | null }[],
  byRef: Map<string, B6Evidence>
): { links: { requirementId: string; ev: B6Evidence; note: string | null }[]; unknownRefs: string[] } {
  const links: { requirementId: string; ev: B6Evidence; note: string | null }[] = [];
  const unknownRefs: string[] = [];
  for (const p of perReq) {
    const seen = new Set<string>();
    for (const raw of p.refs) {
      const ref = raw.trim();
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      const ev = byRef.get(ref);
      if (!ev) {
        unknownRefs.push(ref);
        continue;
      }
      links.push({ requirementId: p.row.id, ev, note: p.note });
    }
  }
  return { links, unknownRefs };
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
 * B1 + B2 + B3 + B4 — the automatic half, fired at capture time.
 *
 * Ends at the screening gate: a lead with no roadblocks and no misalignments is
 * auto-advanced to `selected` (nothing for a human to weigh — forcing a click
 * there was manufacturing a decision), anything flagged parks at `scoring_queue`
 * and waits. B1's hold gate is a real short-circuit here: B2–B4 no longer burn
 * three LLM calls on a posting B1 already knows is stale. That's what
 * docs/PIPELINE.md's own G1 diagram has always claimed the code did.
 *
 * B2 (Extract requirements) joined this half in the reorder — it used to be B5,
 * in the batch half. It has to run before B3 so a roadblock can name the
 * requirement row it blocks (§2.5), and running it at capture is what lets the
 * Map show the requirement side with no manual trigger (§2.4).
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
    if (hold) return reports; // ← the gate. B2–B4 don't run; "Screen anyway" is the manual override.
  }

  // ── B2 · Extract requirements (reuse seeded if present) ──────────────────
  // First LLM call of the phase since the reorder. `requirements` is carried down
  // to B3 so a roadblock can name the row it blocks (§2.5).
  let requirements = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)));
  {
    const t = Date.now();
    let summary: string;
    let model = 'sonnet (reused)';

    // 2026-07-31 — B2's zod schema has no floor (`requirements: z.array(...).default([])`),
    // so ANY non-negative count is schema-valid: runStructured logs "ok", its retry never
    // fires, and B3–B6 all happily proceed against whatever landed (B5/B6 both degrade to
    // rating the raw JD when reqList is thin). Discovered the hard way on two real leads —
    // one came back with 0 requirements, the next with exactly 1 from a multi-paragraph
    // Vestas posting — and in both cases the trace panel showed all six steps LIVE with no
    // error, while the Map quietly stayed empty or near-empty.
    //
    // A one-line vacancy blurb can genuinely have only one real demand, so the floor only
    // engages once there's enough JD prose that under-reading it is implausible — a fixed
    // "must be non-zero" wasn't enough (see the Vestas case), so past 600 characters this
    // requires a handful, not just one.
    const substantial = jd.trim().length > 200;
    const minExpected = jd.trim().length > 600 ? 4 : 1;
    const tooThin = (n: number) => substantial && n < minExpected;

    // Rows already present ⇒ seeded (SharePoint import) or a prior run. Skipping
    // re-extraction is what makes this half idempotent — unless what's seeded is itself
    // a thin, pre-guard extraction; reusing that forever would just perpetuate the bug
    // this guard exists to catch. Clear it and fall through to a fresh attempt instead.
    if (requirements.length > 0 && tooThin(requirements.length)) {
      // B6's evidence links go with them: they carry `requirement_id`, so leaving
      // them behind would strand chips in the Map's lanes pointing at rows that no
      // longer exist — visible evidence that traces to nothing.
      await db
        .delete(requirementEvidence)
        .where(and(eq(requirementEvidence.jobLeadId, leadId), eq(requirementEvidence.ownerId, effectiveOwnerId)));
      await db
        .delete(jobRequirements)
        .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)));
      requirements = [];
    }

    if (requirements.length > 0) {
      summary = `${requirements.length} requirements (kept)`;
    } else {
      // The floor is enforced by re-asking, not by giving up. runStructured's own
      // retry can never fire here — a thin extraction is schema-valid, so there is
      // nothing for zod to reject — which is exactly why this loop exists at this
      // layer instead. Completing B2's `required` list took the misfire rate from
      // ~100% to roughly 1-in-10 (CI note §4); a couple of re-asks absorb what is
      // left, and a lead that genuinely cannot be read still ends in the throw.
      const ATTEMPTS = 3;
      const extract = async () =>
        runStructured({
          step: 'B2',
          model: 'sonnet',
          system: await systemPromptFor('B2', effectiveOwnerId),
          user: `JOB DESCRIPTION:\n${jd || lead.title}`,
          tool: B2.tool,
          zod: B2.zod,
          mock: () => mockRequirements(jd),
          leadId,
          ownerId: effectiveOwnerId,
        });

      let r = await extract();
      model = r.model;
      for (let attempt = 2; attempt <= ATTEMPTS && tooThin(r.data.requirements.length); attempt++) {
        r = await extract();
        model = r.model;
      }
      if (tooThin(r.data.requirements.length)) {
        throw new Error(
          `B2 extracted only ${r.data.requirements.length} requirement(s) from a ${jd.trim().length}-character JD, ` +
            `after ${ATTEMPTS} attempts — ` +
            (r.data.requirements.length === 0
              ? 'the model call misfired rather than the JD genuinely being empty.'
              : 'too few for a posting this long to be a genuine full reading.') +
            ' Nothing was written; re-run screening to retry.'
        );
      }
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
              groupRank: req.groupRank ?? null,
              requirement: req.requirement,
              description: req.description ?? null,
              // §3 · the verbatim JD sentence, distinct from the paraphrase in
              // `description`. Null on leads screened before this shipped (§4.3
              // — no back-catalogue re-run), which the Map renders as "no quote".
              sourceText: req.sourceText ?? null,
              skills: req.skills,
            }))
          )
          .returning();
      }
      summary = `${requirements.length} extracted`;
    }
    const ms = Date.now() - t;
    await recordRun(leadId, 'B2', model, { count: requirements.length }, ms, effectiveOwnerId);
    reports.push({ step: 'B2', label: 'Extract requirements', status: 'done', model, ms, summary });
  }

  // ── B3 · Roadblocks ──────────────────────────────────────────────────────
  let roadblockCount = 0;
  {
    // Requirements are numbered for the model exactly the way B6 numbers them, so
    // it can return `requirementOrder` to attach a roadblock to one specific row.
    const reqList = requirements.length
      ? `\n\nREQUIREMENTS:\n${requirements
          .map((q, i) => `${i + 1}. [${q.rank}] ${q.requirement}`)
          .join('\n')}\n\nIf a roadblock blocks exactly one of the requirements above, set its "requirementOrder" to that number. Set it to 0 when the roadblock is implied across the posting as a whole — do not force a mapping.`
      : '';
    const r = await runStructured({
      step: 'B3',
      model: 'sonnet',
      system: await systemPromptFor('B3', effectiveOwnerId),
      user: `JOB DESCRIPTION:\n${jd || lead.title}${reqList}`,
      tool: B3.tool,
      zod: B3.zod,
      mock: () => mockRoadblocks(jd, lead.roadblocks ?? []),
      leadId,
      ownerId: effectiveOwnerId,
    });
    // Resolve `order` → row id before persisting: the stored Roadblock carries a
    // real `requirementId` (§2.5), because the order numbers are per-run prompt
    // positions and would silently mean something else on a re-extraction.
    // `> 0`, not `!= null`: requirementOrder is required in the strict schema
    // now, and an integer has no empty form, so 0 is the agreed "blocks the
    // posting as a whole" sentinel (see the schema's own description).
    const roadblocks = r.data.roadblocks.map(({ dimension, detail, requirementOrder }) => {
      const row = requirementOrder != null && requirementOrder > 0 ? requirements[requirementOrder - 1] : undefined;
      return { dimension, detail, ...(row ? { requirementId: row.id } : {}) };
    });
    await db
      .update(jobLeads)
      .set({ roadblocks })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    await recordRun(leadId, 'B3', r.model, r.data, r.ms, effectiveOwnerId);
    roadblockCount = roadblocks.length;
    reports.push({ step: 'B3', label: 'Roadblocks', status: 'done', model: r.model, ms: r.ms, summary: roadblocks.length ? `${roadblocks.length} flagged` : 'None' });
  }

  // ── B4 · Misalignments ───────────────────────────────────────────────────
  {
    // B4 weighs the role against the candidate's values & motives, not just the
    // JD — load the Values & Motives summary so the judgment matches the method.
    const valuesSummary = readValuesSummary();
    const r = await runStructured({
      step: 'B4',
      model: 'sonnet',
      system: await systemPromptFor('B4', effectiveOwnerId),
      user:
        `JOB DESCRIPTION:\n${jd || lead.title}\nCITY: ${lead.city ?? 'unknown'}` +
        (valuesSummary ? `\n\nCANDIDATE VALUES & MOTIVES:\n${valuesSummary}` : ''),
      tool: B4.tool,
      zod: B4.zod,
      mock: () => mockMisalignments(jd, lead.city, lead.misalignments ?? []),
      leadId,
      ownerId: effectiveOwnerId,
    });
    await db
      .update(jobLeads)
      .set({ misalignments: r.data.misalignments })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    await recordRun(leadId, 'B4', r.model, r.data, r.ms, effectiveOwnerId);
    reports.push({ step: 'B4', label: 'Misalignments', status: 'done', model: r.model, ms: r.ms, summary: r.data.misalignments.length ? `${r.data.misalignments.length} flagged` : 'None' });

    // ── The screening gate ────────────────────────────────────────────────
    // Clean (nothing flagged by either step) → straight to `selected`, no click.
    // Flagged → `scoring_queue`, which is the only thing the Queue tab shows, so
    // its count is a real "needs you" signal rather than "everything captured".
    // Misalignments park the lead here; they never kill it (§2.2d).
    await db
      .update(jobLeads)
      .set({ status: gateStatusFor(roadblockCount, r.data.misalignments.length), updatedAt: new Date() })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
  }

  return reports;
}

/**
 * B5 + B6 — the batch half, driven by the Ready-to-score runner.
 *
 * Two steps now, not three: extraction moved out of here and into the automatic
 * half as B2 (see the reorder note at the top of this file). What's left is the
 * pair that is genuinely a spend decision — Areas of Expertise, and the Opus
 * scoring pass — so this is the half the user triggers per batch from the queue.
 *
 * Marks the lead `screening` first: a transient, per-lead "in flight" marker the
 * enum has carried since 0000 without anything ever setting it. It is also the
 * stuck-lead signal — a hard Vercel kill mid-batch leaves the lead here, and the
 * Ready-to-score tab flags `screening` rows whose `updatedAt` has gone stale.
 * Retrying is safe by construction: both steps overwrite columns rather than
 * appending, and requirements are read, never re-extracted, here.
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

  // ── B5 · Skill mapping + JD group ────────────────────────────────────────
  // No atsSystem write. It used to be `atsSystem: r.data.atsSystem ?? lead.atsSystem`,
  // which let a value this step inferred from JD prose overwrite the deterministic
  // hostname match A1 already stored — a verified value replaced by an
  // unverifiable one, against NON_NEGOTIABLES. A1 owns ATS end to end now
  // (CI · Lead Page as Pipeline Canvas §2.2a). Do not reintroduce this write.
  //
  // This step is passed the extracted requirements now, which is the whole point
  // of the reorder: its note is called "Translate Requirements to Areas of
  // Expertise", and until B2 ran first there were no requirements to translate,
  // so it silently rated the raw JD instead.
  {
    const requirementRows = await db
      .select()
      .from(jobRequirements)
      .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)));
    const reqList = requirementRows.length
      ? `\n\nREQUIREMENTS (extracted at B2):\n${requirementRows
          .map((q, i) => `${i + 1}. [${q.rank}] ${q.requirement}${q.description ? ` — ${q.description}` : ''}`)
          .join('\n')}`
      : '';
    const r = await runStructured({
      step: 'B5',
      model: 'sonnet',
      system: await systemPromptFor('B5', effectiveOwnerId),
      user: `JOB DESCRIPTION:\n${jd || lead.title}${reqList}`,
      tool: B5.tool,
      zod: B5.zod,
      mock: () => mockSkillMapping(lead),
      leadId,
      ownerId: effectiveOwnerId,
    });
    const ratings = Object.fromEntries(r.data.skills.map((s) => [s.dimension, s.rating]));
    await db
      .update(jobLeads)
      .set({
        skillRatings: ratings,
        // `||`, not `??`, on all three: these are required in the strict schema
        // now, so "no answer" arrives as "" rather than absent — `??` would
        // overwrite a stored value with an empty string.
        jdGroupPrimary: r.data.jdGroupPrimary || lead.jdGroupPrimary,
        jdGroupSecondary: r.data.jdGroupSecondary || lead.jdGroupSecondary,
        // "Key Patterns & CV Tailoring Notes" — B5's process note has always
        // asked the model for this (§B step 3) and the tool schema has always
        // returned it, but the write path dropped it, so key_patterns stayed
        // empty on every lead captured since launch. `|| lead.keyPatterns`
        // preserves a legacy SharePoint-imported value if this call returns nothing.
        keyPatterns: r.data.notes || lead.keyPatterns,
      })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    await recordRun(leadId, 'B5', r.model, r.data, r.ms, effectiveOwnerId);
    reports.push({ step: 'B5', label: 'Skills · JD group', status: 'done', model: r.model, ms: r.ms, summary: `${r.data.skills.length} rated · ${r.data.jdGroupPrimary ?? '—'}` });
  }

  // Requirements are read, not extracted: B2 already produced them at capture.
  // B6 below writes per-requirement scores back onto these rows by id.
  const requirements = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)));

  // ── B6 · Role fit (Opus judgments → deterministic rollup) ────────────────
  {
    // The Master Bullet Bank — the reference B6's note has always been written
    // against and which the implementation never actually sent (CI §1). Without
    // it, "No Match" meant "no evidence was supplied", not "no evidence exists",
    // and the two were indistinguishable in the output.
    const { items: evidence, bankVersion } = await gatherB6Evidence(effectiveOwnerId);
    const byRef = new Map(evidence.map((e) => [e.ref, e]));

    const r = await runStructured({
      step: 'B6',
      model: 'opus',
      system: await systemPromptFor('B6', effectiveOwnerId),
      // Two blocks, and the split matters: the evidence listing is owner-wide and
      // lead-independent — byte-identical across every lead in a scoring batch —
      // so it carries its own 1h cache breakpoint and is read from cache for every
      // lead after the first. The per-lead JD and requirements follow as the
      // varying suffix. Same shape C2 already uses (lib/pipeline/tailoring.ts).
      user: [
        { type: 'text' as const, text: renderB6Evidence(evidence), cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } },
        {
          type: 'text' as const,
          text:
            `JOB DESCRIPTION:\n${jd || lead.title}\n\nREQUIREMENTS:\n${requirements
              .map((q, i) => `${i + 1}. [${q.rank}] ${q.requirement}`)
              .join('\n')}\n\n` +
            `For each requirement, set "order" to its number above and list in "evidenceRefs" every ref code ` +
            `from CANDIDATE EVIDENCE that genuinely supports it — several where several apply, none where none do. ` +
            `Cite only codes that appear in that list. Where nothing supports the requirement, use "No Match", ` +
            `leave "evidenceRefs" empty, and state in "gaps" what is missing.`,
        },
      ],
      tool: B6.tool,
      zod: B6.zod,
      mock: () => mockRoleFit(lead.skillRatings ?? {}, lead.atsSystem, requirements, evidence),
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
      return {
        row: q,
        score,
        matchStrength: j?.matchStrength ?? matchStrengthForScore(score),
        // §B.1.2 asks for both, and both columns have existed on job_requirements
        // since 0000 — the write path simply never filled them. `keyStrengths` is
        // what the evidence covers, `gaps` is B6's own Initial_Missing_Weak.
        //
        // Blanks are normalized to null: a complete `required` list means the model
        // always emits the KEY, so "nothing to say here" arrives as "" rather than
        // as an absent field, and storing that would make every `IS NOT NULL` read
        // downstream lie about what B6 actually said.
        keyStrengths: nullIfBlank(j?.keyStrengths),
        gaps: nullIfBlank(j?.gaps),
        refs: j?.evidenceRefs ?? [],
        note: nullIfBlank(j?.evidenceNote),
      };
    });
    for (const p of perReq) {
      await db
        .update(jobRequirements)
        .set({
          initialScore: p.score,
          initialMatchStrength: p.matchStrength,
          initialKeyStrengths: p.keyStrengths,
          initialMissingWeak: p.gaps,
        })
        .where(and(eq(jobRequirements.id, p.row.id), eq(jobRequirements.ownerId, effectiveOwnerId)));
    }

    // The evidence lanes. Replaced wholesale so a re-score never accumulates links
    // from a previous run alongside the current one.
    const { links, unknownRefs } = resolveEvidenceLinks(perReq, byRef);
    await db
      .delete(requirementEvidence)
      .where(and(eq(requirementEvidence.jobLeadId, leadId), eq(requirementEvidence.ownerId, effectiveOwnerId)));
    if (links.length) {
      await db.insert(requirementEvidence).values(
        links.map((l) => ({
          ownerId: effectiveOwnerId ?? undefined,
          jobLeadId: leadId,
          requirementId: l.requirementId,
          evidenceRef: l.ev.ref,
          evidenceKind: l.ev.kind,
          evidenceText: l.ev.text,
          cvPosition: l.ev.cvPosition,
          note: l.note,
        }))
      );
    }
    if (unknownRefs.length) {
      // Not an error — the citation was dropped, the score stands. Printed because
      // a model inventing ref codes is exactly the failure NON_NEGOTIABLES exists
      // to catch, and it would otherwise be invisible.
      console.warn(`[B6] dropped ${unknownRefs.length} citation(s) not in the bank: ${[...new Set(unknownRefs)].join(', ')}`);
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
        // The version of the bank this score was ACTUALLY produced against — null
        // when the owner has no bank. Was a hardcoded '2026-06' literal, stamped by
        // a step that had never seen a bank (CI §1, defect 3).
        bulletBankVersion: bankVersion,
        status: hold ? 'hold' : 'screened',
      })
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));

    await recordRun(
      leadId,
      'B6',
      r.model,
      { ...dims, overall, recommendation, evidenceSent: evidence.length, evidenceLinks: links.length, bankVersion, unknownRefs },
      r.ms,
      effectiveOwnerId
    );
    reports.push({
      step: 'B6',
      label: 'Role fit score',
      status: 'done',
      model: r.model,
      ms: r.ms,
      summary: `${overall.toFixed(1)} / 10 · ${recommendation} · ${links.length} evidence link${links.length === 1 ? '' : 's'}`,
    });
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
  // always match — B1 runs on every path.) B2 is Extract requirements since the
  // reorder, and it is still the first step after B1, so this check is unchanged.
  if (!initial.some((r) => r.step === 'B2')) return initial;
  const scoring = await runScoring(leadId, ownerId);
  return [...initial, ...scoring];
}

// ── Mock heuristics (deterministic; grounded in the JD text + seeded data) ───
type LeadRow = typeof jobLeads.$inferSelect;
type ReqRow = typeof jobRequirements.$inferSelect;

// No `requirementOrder` in the mock output: mapping a roadblock onto a specific
// requirement row is a judgment about the posting's wording, not something a
// regex over JD text can do honestly (§2.5 — unmapped roadblocks are a normal,
// expected outcome and still render in Key Patterns). Mock re-runs therefore
// leave every roadblock unmapped, which the Map renders correctly.
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

// No ATS detection in the B4 mock either — the old `detectAts(jd)` regex over JD
// text was exactly the prose inference §2.2a removed from the live path, and
// leaving it in the mock would keep reproducing the bug in mock runs.
function mockSkillMapping(lead: LeadRow) {
  const ratings = (lead.skillRatings ?? {}) as Record<string, number>;
  const skills = Object.entries(ratings).map(([dimension, rating]) => ({ dimension, rating }));
  return {
    skills,
    jdGroupPrimary: lead.jdGroupPrimary ?? null,
    jdGroupSecondary: lead.jdGroupSecondary ?? null,
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
      // The mock picks whole JD lines, so the line it picked *is* the verbatim
      // source — this is the one field the mock can populate honestly.
      sourceText: requirement,
      rank: i < 4 ? 'Core' : i < 8 ? 'Important' : 'Nice-to-Have',
      skills: [],
    })),
  };
}

// Word-overlap evidence pick, mirroring the C2 mock (lib/pipeline/tailoring.ts).
// Honest about what it is: a regex can't judge whether a bullet supports a
// requirement, so it cites only where words genuinely coincide and cites nothing
// otherwise — which is what makes a mock run exercise both the linked and the
// unlinked lane rendering.
const mockTokens = (s: string): Set<string> => new Set((s || '').toLowerCase().match(/[a-z]{4,}/g) ?? []);
const mockOverlap = (a: Set<string>, b: Set<string>): number => {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
};

function mockRoleFit(ratings: Record<string, number>, ats: string | null, reqs: ReqRow[], evidence: B6Evidence[]) {
  const ratingScores = Object.values(ratings).map((r) => (r === 1 ? 9 : r === 2 ? 7 : 5));
  const relevance = round1(ratingScores.length ? avg(ratingScores) : 6.5);
  const hasLeadership = Object.entries(ratings).some(([k, v]) => /leadership/i.test(k) && v <= 2);
  const seniority = hasLeadership ? 8 : 6.8;
  const scored = evidence.map((e) => ({ e, t: mockTokens(`${e.text} ${e.tags.join(' ')}`) }));
  return {
    relevance,
    seniority,
    impact: 7,
    ats: ats ? 7 : 6,
    requirements: reqs.map((q, i) => {
      const s = q.initialScore ?? matchStrengthToScore(q.initialMatchStrength) ?? 6;
      const rt = mockTokens(`${q.requirement} ${(q.skills ?? []).join(' ')}`);
      const picks = scored
        .map(({ e, t }) => ({ ref: e.ref, n: mockOverlap(rt, t) }))
        .filter((x) => x.n > 1)
        .sort((a, b) => b.n - a.n)
        .slice(0, 2);
      return {
        order: i + 1,
        requirement: q.requirement,
        score: s,
        matchStrength: matchStrengthForScore(s),
        keyStrengths: null,
        gaps: picks.length ? null : 'Mock run: no word-overlap evidence found for this requirement.',
        evidenceRefs: picks.map((p) => p.ref),
        evidenceNote: picks.length ? `Mock link on shared terms: ${[...rt].slice(0, 3).join(', ')}.` : null,
      };
    }),
    summary: 'Mock scoring derived from seeded skill ratings and requirement strengths.',
  };
}
