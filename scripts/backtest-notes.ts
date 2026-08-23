/**
 * The merge gate for CI · "Repoint the Process Notes from Workbooks and SharePoint
 * to the App" (§2.6).
 *
 * ── Why this script has to exist ────────────────────────────────────────────
 * The ten notes in `lib/prompts.ts` `STEP_NOTE` are loaded verbatim as LLM system
 * prompts. The ONLY other consumer of `Process/*.md` is `scripts/seed.ts`, and it
 * reads `CI/*.md` frontmatter. **No test reads a step note's body.** A note can be
 * gutted and `tsc --noEmit` and `vitest run` both stay green. So the usual gate is
 * blind to exactly the change this CI makes, and this A/B is what stands in for it.
 *
 * ── What it measures ────────────────────────────────────────────────────────
 * The RELIABILITY OF THE PROCESS RUNNING, not the scores. A repoint that leaves a
 * judgment half a point different is fine; one that makes a step stop emitting its
 * tool call, drop requirements, or invent citations is not. Score drift is printed
 * for visibility and is deliberately not a pass/fail condition.
 *
 * ── Read-only, by construction ──────────────────────────────────────────────
 * Same discipline as `scripts/measure-b6-required.ts`: each step's LLM is called
 * DIRECTLY, never through `runScoring` / `runScreening` / `runEvidenceMapping`, so
 * nothing is written to `job_leads`, `job_requirements`, `requirement_evidence` or
 * `requirement_tailoring`. The stored score of every lead in the cohort is
 * untouched no matter how many times this runs. The only rows it creates are
 * `llm_calls` audit rows — tagged `<STEP>-bt-base` / `<STEP>-bt-cand` so they stay
 * separable from production traffic — which is where it reads its token counts
 * back from.
 *
 * ── Why the prompts come from the pipeline, not from here ───────────────────
 * The system prompt is composed by `composeSystemPrompt` and the user messages by
 * the `b2UserMessage`…`c2UserMessage` builders, all exported from the production
 * modules. A harness that rebuilt these strings locally would drift the first time
 * someone edited a pipeline call site, and would then certify a prompt the app
 * never sends — worse than no backtest at all.
 *
 * ── Why sampled, not single-shot ────────────────────────────────────────────
 * The sibling CI established that a strict-schema collapse is PROBABILISTIC: B2
 * went from ~0/17 requirements to 13/14, which one run either side could never
 * have shown. B6 therefore gets three runs per variant per lead.
 *
 * Usage:
 *   npx tsx scripts/backtest-notes.ts                    # dry run — cohort, plan, call count, no LLM calls
 *   npx tsx scripts/backtest-notes.ts --apply            # the tiered default
 *   npx tsx scripts/backtest-notes.ts --apply --steps B6 --runs 5
 *   npx tsx scripts/backtest-notes.ts --apply --leads <uuid>,<uuid>
 *   npx tsx scripts/backtest-notes.ts --report           # re-render the report from the checkpoint file
 */
import './_env';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { and, count, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads, jobRequirements, llmCalls } from '../lib/db/schema';
import { composeSystemPrompt, stepNoteFile } from '../lib/prompts';
import { ciGuidanceFor } from '../lib/ci';
import { runStructured, type UserContentBlock } from '../lib/llm/client';
import { B2, B3, B4, B5, B6, C2 } from '../lib/llm/schemas';
import {
  b2UserMessage,
  b3UserMessage,
  b4UserMessage,
  b5UserMessage,
  b6UserMessage,
  gatherB6Evidence,
  type B6Evidence,
} from '../lib/pipeline/screening';
import { c2UserMessage, gatherEvidence, gatherSkillVocabulary, CORE_AND_IMPORTANT, type Evidence } from '../lib/pipeline/tailoring';
import type { VocabEntry } from '../lib/pipeline/skills';
import { readValuesSummary } from '../lib/profile-context';
import { overallFit, requirementAlignment, recommendationFor } from '../lib/scoring';
import { isLiveLlm, env } from '../lib/env';

type StepCode = 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'C2';
type Variant = 'base' | 'cand';
const ALL_STEPS: StepCode[] = ['B2', 'B3', 'B4', 'B5', 'B6', 'C2'];

/**
 * The tiered default, agreed with the owner. B6 carries the deep sampling because
 * it is the Opus scoring pass and the one whose schema the sibling CI showed can
 * collapse probabilistically; the Sonnet steps get a narrower but still paired run.
 */
const PLAN: Record<StepCode, { leads: number; runs: number }> = {
  B6: { leads: 7, runs: 3 },
  B2: { leads: 3, runs: 2 },
  B3: { leads: 3, runs: 2 },
  B4: { leads: 3, runs: 2 },
  B5: { leads: 3, runs: 2 },
  C2: { leads: 3, runs: 2 },
};

// ── Result row ───────────────────────────────────────────────────────────────

type Row = {
  key: string;
  step: StepCode;
  variant: Variant;
  leadId: string;
  leadLabel: string;
  run: number;
  /** The step produced a schema-valid tool call. False is a hard failure. */
  ok: boolean;
  error?: string;
  /**
   * The call never reached the model — DNS, socket, timeout. Tracked apart from a
   * model-level failure because it says nothing about the prompt: the first B6
   * re-run blocked the merge on a single `fetch failed` with `out=0`, which is a
   * flaky network, not a regression. Counted and reported, never gating.
   */
  transport?: boolean;
  stop: string | null;
  inTok: number;
  cacheW: number;
  cacheR: number;
  outTok: number;
  /** Step-specific reliability measures — see scoreRun(). */
  m: Record<string, number | string | null>;
  /** A template cell copied out of the note into the answer. Always a hard failure. */
  leaks: string[];
  /** Each leak with the text around it, so a false positive can be told from a real one. */
  leakContext?: string[];
  /**
   * The head of the returned payload. Cheap, and the difference between "the run
   * collapsed" and knowing WHY: a collapse and a leak both look identical in the
   * metrics, and re-running to find out costs another live call.
   */
  sample?: string;
};

// ── Note loading: baseline out of git, candidate off disk ────────────────────

/**
 * `git show <ref>:Process/<file>` rather than a stash-and-swap. Both variants then
 * exist simultaneously, the run is repeatable, and the working tree is never
 * touched — which matters because the working tree is what the dev server would
 * read if one were running.
 *
 * execFileSync, not a shell: two of these filenames carry spaces and one carries
 * an `&`.
 */
/**
 * Line endings are normalized on BOTH sides, and that is not cosmetic. This repo
 * sets `* text=auto` with `core.autocrlf=true`, so git stores LF while the Windows
 * working tree holds CRLF: an untouched 272-line note reads as 272 bytes larger off
 * disk than out of `git show`. Without this the two variants would differ by
 * whitespace on every line of every note, the "identical baseline" check could
 * never fire, and every measured difference would be confounded.
 */
const lf = (s: string) => s.replace(/\r\n/g, '\n');

function noteFromGit(ref: string, step: string): string {
  const file = stepNoteFile(step);
  if (!file) throw new Error(`${step} is not in STEP_NOTE — it is not loaded as a system prompt`);
  return lf(execFileSync('git', ['show', `${ref}:Process/${file}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

function noteFromDisk(step: string): string {
  const file = stepNoteFile(step);
  if (!file) throw new Error(`${step} is not in STEP_NOTE`);
  return lf(fs.readFileSync(path.join(process.cwd(), 'Process', file), 'utf8'));
}

/**
 * Placeholder cells the note itself contains, e.g. `[short label]`, `[verbatim JD
 * sentence, unedited]`, `[Full Group Name]`. Extracted FROM THE NOTE rather than
 * hardcoded, so the check tracks whatever templates a note actually carries.
 *
 * This is §2.3's stated rationale made mechanical: during the B2 investigation the
 * model was observed emitting the literal value `placeholder`, because a template
 * in the prompt is a thing the model may copy. If a token from the note comes back
 * in the answer, the note taught it to say that.
 *
 * `[[wiki links]]` and `[!Callout]` markers are excluded — they are Obsidian
 * syntax, not output templates.
 */
function templateTokens(note: string): string[] {
  const out = new Set<string>();
  for (const m of note.matchAll(/\[([^\[\]\n]{3,60})\]/g)) {
    const inner = m[1].trim();
    if (!inner || inner.startsWith('!') || inner.startsWith('[')) continue;
    if (/^(x| )$/i.test(inner)) continue; // task-list checkboxes
    if (/^https?:/i.test(inner)) continue;
    // Requires a space or a slash: single words like [Core] are legitimate content
    // this step really does emit, and flagging them would be pure noise.
    if (!/[\s/]/.test(inner)) continue;
    out.add(inner.toLowerCase());
  }
  return [...out];
}

/**
 * Returns both the matched tokens AND the surrounding text, because "a leak
 * happened" is not actionable. The first full run of this harness reported six
 * candidate `placeholder` leaks against two on baseline and blocked the merge —
 * and the word appears in neither version of the notes involved, so there was
 * nothing to read. Without the context there is no way to tell a real copied
 * template from a JD that happens to use the word.
 */
function findLeaks(data: unknown, tokens: string[]): { hits: string[]; context: string[] } {
  const raw = JSON.stringify(data ?? {});
  const hay = raw.toLowerCase();
  const hits: string[] = [];
  const context: string[] = [];
  const record = (label: string, at: number) => {
    hits.push(label);
    context.push(`${label} → …${raw.slice(Math.max(0, at - 70), at + 90).replace(/\s+/g, ' ')}…`);
  };
  for (const t of tokens) {
    const at = hay.indexOf(t);
    if (at !== -1) record(t, at);
  }
  const m = /"[^"]*\bplaceholder\b[^"]*"/.exec(hay);
  if (m) record('placeholder (literal)', m.index);
  return { hits: [...new Set(hits)], context };
}

// ── Per-lead context, loaded once and shared across variants and runs ────────

type LeadCtx = {
  id: string;
  ownerId: string;
  label: string;
  jd: string;
  title: string;
  company: string | null;
  city: string | null;
  requirements: { id: string; rank: string | null; requirement: string; description: string | null; requirementOrder: number | null; skills: string[] | null }[];
  b6Evidence: B6Evidence[];
  b6Refs: Set<string>;
  c2Evidence: Evidence[];
  c2Refs: Set<string>;
  c2Vocabulary: VocabEntry[];
  values: string;
};

async function loadLeadCtx(leadId: string): Promise<LeadCtx> {
  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  const owner = lead.ownerId;
  if (!owner) throw new Error(`Lead ${leadId} has no ownerId`);
  const requirements = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, owner)));
  const { items: b6Evidence } = await gatherB6Evidence(owner);
  const c2Evidence = await gatherEvidence(owner);
  // Production sends the curated vocabulary as a second cached block and each
  // requirement's own Requirement Skills; a backtest that omits them certifies
  // a prompt production never sends (this file's whole premise).
  const c2Vocabulary = await gatherSkillVocabulary(owner);
  return {
    id: leadId,
    ownerId: owner,
    label: `${lead.title}${lead.company ? ` · ${lead.company}` : ''}`,
    jd: lead.jdText ?? '',
    title: lead.title,
    company: lead.company ?? null,
    city: lead.city ?? null,
    requirements: requirements.map((q) => ({
      id: q.id,
      rank: q.rank,
      requirement: q.requirement,
      description: q.description,
      requirementOrder: q.requirementOrder,
      skills: q.skills ?? null,
    })),
    b6Evidence,
    b6Refs: new Set(b6Evidence.map((e) => e.ref)),
    c2Evidence,
    c2Refs: new Set(c2Evidence.map((e) => e.ref)),
    c2Vocabulary,
    values: readValuesSummary(),
  };
}

// ── The call ─────────────────────────────────────────────────────────────────

/**
 * Mocks are intentionally degenerate: this script refuses to run unless
 * `isLiveLlm`, so they are unreachable. They exist only to satisfy `RunArgs`.
 */
async function callStep(step: StepCode, variant: Variant, ctx: LeadCtx, note: string) {
  const system = { cacheable: composeSystemPrompt(step, note), dynamic: await ciGuidanceFor(step, ctx.ownerId) };
  const tag = `${step}-bt-${variant}`;
  const common = { model: 'sonnet' as const, system, leadId: ctx.id, ownerId: ctx.ownerId };

  switch (step) {
    case 'B2':
      return runStructured({ ...common, step: tag, user: b2UserMessage(ctx.jd, ctx.title), tool: B2.tool, zod: B2.zod, mock: () => ({ requirements: [] }) });
    case 'B3':
      return runStructured({ ...common, step: tag, user: b3UserMessage(ctx.jd, ctx.title, ctx.requirements), tool: B3.tool, zod: B3.zod, mock: () => ({ roadblocks: [] }) });
    case 'B4':
      return runStructured({ ...common, step: tag, user: b4UserMessage(ctx.jd, ctx.title, ctx.city, ctx.values), tool: B4.tool, zod: B4.zod, mock: () => ({ misalignments: [] }) });
    case 'B5':
      return runStructured({ ...common, step: tag, user: b5UserMessage(ctx.jd, ctx.title, ctx.requirements), tool: B5.tool, zod: B5.zod, mock: () => ({ skills: [] }) });
    case 'B6':
      return runStructured({
        ...common,
        model: 'opus',
        step: tag,
        user: b6UserMessage(ctx.b6Evidence, ctx.jd, ctx.title, ctx.requirements),
        tool: B6.tool,
        zod: B6.zod,
        mock: () => ({ relevance: 0, seniority: 0, impact: 0, ats: 0, requirements: [], summary: '' }),
      });
    case 'C2': {
      const coreImp = ctx.requirements.filter((r) => CORE_AND_IMPORTANT.includes(r.rank ?? ''));
      const numbered = coreImp.map(
        (q, i) => [q.requirementOrder ?? i + 1, q] as [number, { rank: string | null; requirement: string; skills: string[] | null }]
      );
      return runStructured({
        ...common,
        model: 'opus',
        step: tag,
        user: c2UserMessage(ctx.c2Evidence, ctx.title, ctx.company, numbered, null, ctx.c2Vocabulary) as UserContentBlock[],
        tool: C2.tool,
        zod: C2.zod,
        mock: () => ({ links: [], gaps: [] }),
      });
    }
  }
}

// ── Metrics ──────────────────────────────────────────────────────────────────

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

/* eslint-disable @typescript-eslint/no-explicit-any */
function scoreRun(step: StepCode, data: any, ctx: LeadCtx): Record<string, number | string | null> {
  switch (step) {
    case 'B2': {
      const reqs = data.requirements ?? [];
      return {
        count: reqs.length,
        onFile: ctx.requirements.length,
        withSourceText: pct(reqs.filter((r: any) => (r.sourceText ?? '').trim()).length, reqs.length),
        withGroupRank: pct(reqs.filter((r: any) => r.groupRank != null).length, reqs.length),
        ranksSeen: [...new Set(reqs.map((r: any) => r.rank))].sort().join('/') || '—',
      };
    }
    case 'B3':
      return { flagged: (data.roadblocks ?? []).length, mappedToReq: (data.roadblocks ?? []).filter((r: any) => r.requirementOrder != null).length };
    case 'B4':
      return { flagged: (data.misalignments ?? []).length, withSeverity: (data.misalignments ?? []).filter((m: any) => (m.severity ?? '').trim()).length };
    case 'B5': {
      const skills = data.skills ?? [];
      return {
        dimensions: new Set(skills.map((s: any) => s.dimension)).size,
        expected: 17,
        jdGroup: data.jdGroupPrimary ?? null,
        notesChars: (data.notes ?? '').length,
      };
    }
    case 'B6': {
      const reqs = data.requirements ?? [];
      const onFile = ctx.requirements.length;
      let cited = 0;
      let fabricated = 0;
      let withEvidence = 0;
      for (const q of reqs) {
        const refs: string[] = q.evidenceRefs ?? [];
        const good = refs.filter((x) => ctx.b6Refs.has(x.trim()));
        cited += good.length;
        fabricated += refs.length - good.length;
        if (good.length) withEvidence++;
      }
      const noMatch = reqs.filter((q: any) => q.matchStrength === 'No Match');
      const dims = {
        relevance: data.relevance,
        seniority: data.seniority,
        impact: data.impact,
        reqAlignment: requirementAlignment(
          ctx.requirements.map((q, i) => {
            const j = reqs.find((x: any) => x.order === i + 1) ?? reqs[i];
            return { score: j?.score ?? 6, rank: q.rank };
          })
        ),
        ats: data.ats,
      };
      const overall = overallFit(dims);
      return {
        coverage: pct(reqs.length, onFile),
        judged: reqs.length,
        onFile,
        withEvidence,
        refs: cited,
        fabricated,
        keyStrengths: pct(reqs.filter((q: any) => (q.keyStrengths ?? '').trim()).length, reqs.length),
        gaps: pct(reqs.filter((q: any) => (q.gaps ?? '').trim()).length, reqs.length),
        noMatchWithReason: `${noMatch.filter((q: any) => (q.gaps ?? '').trim()).length}/${noMatch.length}`,
        overall: Number(overall.toFixed(1)),
        recommendation: recommendationFor(overall),
      };
    }
    case 'C2': {
      const links = data.links ?? [];
      const coreImp = ctx.requirements.filter((r) => CORE_AND_IMPORTANT.includes(r.rank ?? '')).length;
      const fabricated = links.filter((l: any) => l.evidenceRef && !ctx.c2Refs.has(String(l.evidenceRef).trim())).length;
      return {
        links: links.length,
        coreImportant: coreImp,
        coverage: pct(new Set(links.map((l: any) => l.order)).size, coreImp),
        fabricated,
        withCvPosition: pct(links.filter((l: any) => (l.cvPosition ?? '').trim()).length, links.length),
        gaps: (data.gaps ?? []).length,
      };
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Reporting ────────────────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const num = (v: unknown) => (typeof v === 'number' ? v : NaN);

const TRANSPORT = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network/i;
/** Derived, not just read off the row, so checkpoints written before this existed reclassify correctly. */
const isTransport = (r: Row) => r.transport ?? (!r.ok && TRANSPORT.test(r.error ?? ''));

function summarise(rows: Row[], step: StepCode, variant: Variant) {
  const v = rows.filter((r) => r.step === step && r.variant === variant);
  if (!v.length) return null;
  // Metrics are averaged over runs that PRODUCED metrics. A failed call carries an
  // empty `m`, and including it made every numeric column fall back to printing the
  // raw value list — one dropped connection turned the whole candidate column into
  // unreadable noise while the baseline column still showed clean means.
  const scored = v.filter((r) => r.ok);
  const keys = [...new Set(scored.flatMap((r) => Object.keys(r.m)))];
  const agg: Record<string, string> = {};
  for (const k of keys) {
    const nums = scored.map((r) => num(r.m[k])).filter((n) => !Number.isNaN(n));
    agg[k] =
      nums.length === scored.length
        ? String(Math.round(mean(nums) * 10) / 10)
        : [...new Set(scored.map((r) => String(r.m[k] ?? '—')))].slice(0, 6).join(', ');
  }
  return {
    n: v.length,
    transport: v.filter(isTransport).length,
    // Model-level failures only — a schema rejection or a refusal. Transport errors
    // are reported separately and never gate.
    failures: v.filter((r) => !r.ok && !isTransport(r)).length,
    leaks: v.filter((r) => r.leaks.length > 0).length,
    badStops: v.filter((r) => r.stop && !['end_turn', 'tool_use', 'stop_sequence'].includes(r.stop)).length,
    // The reliability measure that actually matters, and the one the noise probe
    // showed a mean cannot express: a run that judged well under half the
    // requirements it was given. Nine identical-note runs produced a mean coverage
    // of ~90% made up of eight perfect runs and one that returned 1 of 17 — the
    // mean hid the only interesting event in the sample.
    collapses: v.filter((r) => {
      const c = num(r.m.coverage);
      return !Number.isNaN(c) && c < 50;
    }).length,
    fabricated: v.reduce((a, r) => a + (num(r.m.fabricated) || 0), 0),
    totalIn: Math.round(mean(v.map((r) => r.inTok + r.cacheW + r.cacheR))),
    out: Math.round(mean(v.map((r) => r.outTok))),
    agg,
  };
}

function report(rows: Row[], steps: StepCode[]): string {
  const L: string[] = [];
  L.push(`# Backtest — Process note repoint\n`);
  L.push(`Baseline = notes as on \`main\`; candidate = notes in the working tree. Read-only: no lead's`);
  L.push(`score, requirements, evidence links or tailoring rows were written.\n`);

  const blocking: string[] = [];

  for (const step of steps) {
    const b = summarise(rows, step, 'base');
    const c = summarise(rows, step, 'cand');
    if (!b && !c) continue;
    L.push(`\n## ${step}\n`);
    const keys = [...new Set([...Object.keys(b?.agg ?? {}), ...Object.keys(c?.agg ?? {})])];
    L.push(`| Measure | baseline | candidate |`);
    L.push(`| --- | --- | --- |`);
    L.push(`| runs | ${b?.n ?? 0} | ${c?.n ?? 0} |`);
    L.push(`| **hard failures** (model/schema) | ${b?.failures ?? 0} | ${c?.failures ?? 0} |`);
    L.push(`| transport errors (not gating) | ${b?.transport ?? 0} | ${c?.transport ?? 0} |`);
    L.push(`| bad stop_reason | ${b?.badStops ?? 0} | ${c?.badStops ?? 0} |`);
    L.push(`| **collapsed runs** (coverage < 50%) | ${b?.collapses ?? 0} | ${c?.collapses ?? 0} |`);
    L.push(`| **runs with a template leak** | ${b?.leaks ?? 0} | ${c?.leaks ?? 0} |`);
    L.push(`| fabricated citations (total) | ${b?.fabricated ?? 0} | ${c?.fabricated ?? 0} |`);
    for (const k of keys) L.push(`| ${k} | ${b?.agg[k] ?? '—'} | ${c?.agg[k] ?? '—'} |`);
    L.push(`| mean total input tok | ${b?.totalIn ?? 0} | ${c?.totalIn ?? 0} |`);
    L.push(`| mean output tok | ${b?.out ?? 0} | ${c?.out ?? 0} |`);

    // ── The gate (§2.6) ─────────────────────────────────────────────────────
    //
    // Every condition is RELATIVE to the baseline, and the noise probe is why. Run
    // with both variants pointing at the same unedited notes, this step produced
    // one collapsed run and one `placeholder` leak on EACH side — the model having
    // a bad moment on one lead, identically on both. An absolute rule ("no leaks",
    // "coverage must be 100%") fails a no-op change, which makes the gate useless.
    // What a repoint must not do is make any of these WORSE than leaving the notes
    // alone.
    //
    // The coverage tolerance is for the same reason: a single collapsed run moves
    // the mean by ~10 points on a 3-lead sample, so a strict `<` comparison would
    // block on noise. Collapse COUNT is the un-averaged signal and has no tolerance.
    if (c && b) {
      if (c.failures > b.failures) blocking.push(`${step}: ${c.failures} hard failure(s) vs ${b.failures} on baseline`);
      if (c.badStops > b.badStops) blocking.push(`${step}: ${c.badStops} bad stop_reason vs ${b.badStops} on baseline`);
      if (c.collapses > b.collapses) blocking.push(`${step}: ${c.collapses} collapsed run(s) vs ${b.collapses} on baseline`);
      if (c.leaks > b.leaks) blocking.push(`${step}: ${c.leaks} run(s) leaked a note template vs ${b.leaks} on baseline`);
      // Tolerance of 1, and the reasoning is worth stating because zero-tolerance
      // is the intuitive choice here. A fabricated ref is a NON_NEGOTIABLES matter,
      // but it is already handled defensively at the write path:
      // `resolveEvidenceLinks` drops any code that is not in the listing the model
      // was given, so an invented citation is counted and warned about, never
      // stored. And the noise probe produced one on identical notes (1 in ~380
      // refs cited across nine runs), so a strict `>` blocks a no-op change. Any
      // fabrication at all is still surfaced in the table above.
      if (c.fabricated > b.fabricated + 1) blocking.push(`${step}: ${c.fabricated} fabricated citation(s) vs ${b.fabricated} on baseline`);
      else if (c.fabricated > b.fabricated) {
        L.push(`\n> Note: ${c.fabricated} fabricated citation(s) vs ${b.fabricated} on baseline — within the tolerance of 1,`);
        L.push(`> and dropped by \`resolveEvidenceLinks\` before any write. Worth a look if it recurs.`);
      }
      const covB = num(b.agg.coverage);
      const covC = num(c.agg.coverage);
      if (!Number.isNaN(covB) && !Number.isNaN(covC) && covC < covB - 5) {
        blocking.push(`${step}: mean requirement coverage ${covC}% vs baseline ${covB}% (beyond the 5pt noise tolerance)`);
      }
      if (c.totalIn > b.totalIn) {
        L.push(`\n> ⚠️ Candidate input tokens ROSE (${b.totalIn} → ${c.totalIn}). These notes get shorter — a rise`);
        L.push(`> means something was added rather than removed. Investigate; not an automatic block.`);
      }
      if (b.collapses > 0 || b.leaks > 0) {
        L.push(`\n> **Baseline is not clean here**: ${b.collapses} collapsed run(s) and ${b.leaks} template leak(s) on the`);
        L.push(`> UNEDITED notes. That is a pre-existing defect in this step, not something this change caused,`);
        L.push(`> and it is why every condition above is relative rather than absolute.`);
      }
    }
  }

  L.push(`\n---\n`);
  if (blocking.length) {
    L.push(`## ❌ Gate: BLOCKED\n`);
    for (const b of blocking) L.push(`- ${b}`);
    const ctx = rows.filter((r) => r.variant === 'cand' && r.leakContext?.length);
    if (ctx.length) {
      L.push(`\n### Where the leaks are\n`);
      for (const r of ctx.slice(0, 12)) for (const c of r.leakContext ?? []) L.push(`- \`${r.step}\` ${r.leadLabel.slice(0, 30)} — ${c}`);
    }
  } else {
    L.push(`## ✅ Gate: PASS\n`);
    L.push(`No hard failure, collapse, coverage loss, fabricated citation or template leak **beyond what`);
    L.push(`the unedited notes already produce**. Score drift, where present, is reported above and is`);
    L.push(`deliberately not a gate condition — this CI repoints references, it does not re-specify judgment.`);
  }
  return L.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const a = process.argv.slice(2);
  const val = (flag: string) => {
    const i = a.indexOf(flag);
    return i === -1 ? undefined : a[i + 1];
  };
  return {
    apply: a.includes('--apply'),
    reportOnly: a.includes('--report'),
    base: val('--base') ?? 'main',
    steps: (val('--steps')?.split(',').map((s) => s.trim().toUpperCase()) as StepCode[] | undefined)?.filter((s) => ALL_STEPS.includes(s)) ?? ALL_STEPS,
    runs: val('--runs') ? parseInt(val('--runs')!, 10) : undefined,
    leads: val('--leads')?.split(',').map((s) => s.trim()).filter(Boolean),
    out: val('--out') ?? path.join(process.cwd(), 'scripts', 'data', 'backtest-notes.jsonl'),
  };
}

async function main() {
  const args = parseArgs();
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  const reportPath = args.out.replace(/\.jsonl$/, '.md');

  // Checkpoint: every completed row is appended immediately, and a re-run skips
  // what is already there. A ~100-call run should survive an interruption.
  const done = new Map<string, Row>();
  if (fs.existsSync(args.out)) {
    for (const line of fs.readFileSync(args.out, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as Row;
      done.set(r.key, r);
    }
  }

  if (args.reportOnly) {
    const md = report([...done.values()], args.steps);
    fs.writeFileSync(reportPath, md, 'utf8');
    console.log(md);
    console.log(`\nRe-rendered from ${done.size} checkpointed row(s) → ${reportPath}`);
    process.exit(0);
  }

  // ── Cohort ────────────────────────────────────────────────────────────────
  let cohort: { id: string; label: string }[];
  if (args.leads) {
    const rows = await db.select().from(jobLeads);
    cohort = args.leads.map((id) => {
      const l = rows.find((r) => r.id === id);
      if (!l) throw new Error(`Lead ${id} not found`);
      return { id, label: `${l.title}${l.company ? ` · ${l.company}` : ''}` };
    });
  } else {
    // Over-fetch, then drop leads with no requirements on file. Such a lead cannot
    // be backtested: requirement coverage is undefined, `pct()` returns 0 for it,
    // and the run then counts as a collapse on BOTH variants — six phantom
    // collapses in the first full run, purely from one lead that B2 had never
    // successfully extracted. Filtering here rather than special-casing the metric
    // keeps "collapse" meaning one thing.
    const candidates = await db
      .select()
      .from(jobLeads)
      .where(and(isNotNull(jobLeads.overallFitScore), isNotNull(jobLeads.jdText)))
      .orderBy(desc(jobLeads.updatedAt))
      .limit(30);
    const withReqs: typeof candidates = [];
    const skipped: string[] = [];
    for (const l of candidates) {
      if (withReqs.length === 7) break;
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(jobRequirements)
        .where(and(eq(jobRequirements.jobLeadId, l.id), eq(jobRequirements.ownerId, l.ownerId)));
      if (Number(n) > 0) withReqs.push(l);
      else skipped.push(`${l.title}${l.company ? ` · ${l.company}` : ''}`);
    }
    if (skipped.length) {
      console.log(`\nSkipped ${skipped.length} scored lead(s) with 0 requirements on file — nothing to measure coverage against:`);
      for (const s of skipped) console.log(`  · ${s}`);
    }
    cohort = withReqs.map((l) => ({ id: l.id, label: `${l.title}${l.company ? ` · ${l.company}` : ''}` }));
  }

  console.log(`\n── Cohort: the ${cohort.length} most recently scored lead(s) with a JD on file ──`);
  cohort.forEach((l, i) => console.log(`  ${i + 1}. ${l.label}   ${l.id}`));

  // ── Plan ──────────────────────────────────────────────────────────────────
  type Job = { step: StepCode; leadId: string; leadLabel: string; run: number };
  const jobs: Job[] = [];
  for (const step of args.steps) {
    const p = PLAN[step];
    const runs = args.runs ?? p.runs;
    for (const lead of cohort.slice(0, args.leads ? cohort.length : p.leads)) {
      for (let run = 1; run <= runs; run++) jobs.push({ step, leadId: lead.id, leadLabel: lead.label, run });
    }
  }
  const calls = jobs.length * 2;
  const todo = jobs.filter((j) => !done.has(`${j.step}|${j.leadId}|base|${j.run}`) || !done.has(`${j.step}|${j.leadId}|cand|${j.run}`));

  console.log(`\n── Plan ──`);
  for (const step of args.steps) {
    const n = jobs.filter((j) => j.step === step).length;
    console.log(`  ${step.padEnd(3)} ${n} pair(s) × 2 variants = ${n * 2} calls   (${step === 'B6' || step === 'C2' ? 'opus' : 'sonnet'})`);
  }
  console.log(`  ${'total'.padEnd(3)} ${calls} live calls · ${done.size} already checkpointed · ${todo.length} pair(s) left`);
  console.log(`\nBaseline notes: \`git show ${args.base}:Process/<note>\`  ·  candidate: the working tree`);
  console.log(`Checkpoint: ${args.out}`);

  // ── Note diff preview, free ───────────────────────────────────────────────
  console.log(`\n── Notes under test ──`);
  for (const step of args.steps) {
    const base = noteFromGit(args.base, step);
    const cand = noteFromDisk(step);
    const same = base === cand;
    console.log(
      `  ${step.padEnd(3)} ${String(base.length).padStart(6)}B → ${String(cand.length).padStart(6)}B  ` +
        `${same ? '(identical — measuring run-to-run variance only)' : `(${cand.length - base.length > 0 ? '+' : ''}${cand.length - base.length}B)`}` +
        `  template cells: ${templateTokens(base).length} → ${templateTokens(cand).length}`
    );
  }

  if (!args.apply) {
    console.log(`\nDry run — no LLM calls made. Re-run with --apply to spend ${calls} call(s).\n`);
    process.exit(0);
  }
  if (!isLiveLlm) {
    throw new Error(`this backtest is meaningless in mock mode (LLM_MODE=${env.llmMode}) — it would compare two identical mock objects`);
  }

  // ── Run ───────────────────────────────────────────────────────────────────
  const notes: Record<string, Record<Variant, string>> = {};
  for (const step of args.steps) notes[step] = { base: noteFromGit(args.base, step), cand: noteFromDisk(step) };

  const ctxCache = new Map<string, LeadCtx>();
  const rows: Row[] = [...done.values()];
  const sink = fs.createWriteStream(args.out, { flags: 'a' });

  console.log(`\n── Running ──\n`);
  for (const job of jobs) {
    // base and cand back to back for the same lead and run number, so the pair is
    // as close together in time as possible — model-side drift over a long run
    // then lands on both variants rather than on one.
    for (const variant of ['base', 'cand'] as Variant[]) {
      const key = `${job.step}|${job.leadId}|${variant}|${job.run}`;
      if (done.has(key)) continue;

      let ctx = ctxCache.get(job.leadId);
      if (!ctx) {
        ctx = await loadLeadCtx(job.leadId);
        ctxCache.set(job.leadId, ctx);
      }

      const note = notes[job.step][variant];
      let ok = true;
      let error: string | undefined;
      let m: Record<string, number | string | null> = {};
      let leaks: string[] = [];
      let leakContext: string[] = [];
      let sample: string | undefined;
      try {
        const r = await callStep(job.step, variant, ctx, note);
        m = scoreRun(job.step, r.data, ctx) ?? {};
        ({ hits: leaks, context: leakContext } = findLeaks(r.data, templateTokens(note)));
        sample = JSON.stringify(r.data).slice(0, 900);
      } catch (err) {
        ok = false;
        error = String(err instanceof Error ? err.message : err).slice(0, 300);
      }
      const transport = !ok && /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network/i.test(error ?? '');

      const [call] = await db
        .select()
        .from(llmCalls)
        .where(and(eq(llmCalls.jobLeadId, job.leadId), eq(llmCalls.step, `${job.step}-bt-${variant}`)))
        .orderBy(desc(llmCalls.createdAt))
        .limit(1);

      const row: Row = {
        key,
        step: job.step,
        variant,
        leadId: job.leadId,
        leadLabel: job.leadLabel,
        run: job.run,
        ok,
        error,
        transport,
        stop: call?.stopReason ?? null,
        inTok: call?.inputTokens ?? 0,
        cacheW: call?.cacheCreationTokens ?? 0,
        cacheR: call?.cacheReadTokens ?? 0,
        outTok: call?.outputTokens ?? 0,
        m,
        leaks,
        leakContext,
        sample,
      };
      rows.push(row);
      done.set(key, row);
      sink.write(`${JSON.stringify(row)}\n`);

      const flag = !ok ? 'FAIL' : leaks.length ? 'LEAK' : 'ok  ';
      console.log(
        `  ${flag} ${job.step.padEnd(3)} ${variant.padEnd(4)} run ${job.run} · ${job.leadLabel.slice(0, 38).padEnd(38)} ` +
          `${Object.entries(m).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(' ')}` +
          `${error ? `  — ${error}` : ''}`
      );
    }
  }
  sink.end();

  const md = report(rows, args.steps);
  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`\n${md}`);
  console.log(`\nReport written to ${reportPath}`);
  console.log(`Nothing was written to any lead — scores, requirements, evidence links and tailoring rows are unchanged.\n`);
  process.exit(md.includes('Gate: BLOCKED') ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
