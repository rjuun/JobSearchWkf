---
ci-area: Screening / B-Phase
ci-title: Scoring Phase Redesign
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-07-28
ci-estimated-time: 4
ci-time-spent: 1
pr-source: "[[B1. Capture Posting Freshness and Market Saturation]], [[B2. Identify Roadblocks]], [[B3. Identify Misalignments]], [[B4. Translate Requirements to Areas of Expertise and Define JD Groups]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-07-28T17:48:38.000Z","endTime":"2026-07-28T18:40:00.000Z"},{"name":"Draft","startTime":"2026-07-28T09:45:06.000Z","endTime":"2026-07-28T11:13:07.000Z"},{"name":"Development","startTime":"2026-07-28T16:02:07.000Z","endTime":"2026-07-28T19:02:08.000Z"}]}
```
---

## 1. What is the problem or opportunity?

Today every captured lead sits tagged `captured` until Reggie opens it and manually clicks through
B1→B2→B3→B4→B5→B6 one lead at a time (`runScreening(leadId)` in `lib/pipeline/screening.ts`, triggered
by `runScreeningAction` in `app/actions/pipeline.ts`). The actual workflow is batchy — leads get captured
sporadically through the day via the bookmarklet/capture flow (A1), then once 8–12 have accumulated,
Reggie sits down for a 1–1.5h screening pass and picks 2–3 to move into tailoring. The one-lead-at-a-time
UI matches neither half of that: it forces a manual click on leads that could screen themselves
automatically, and it forces scoring calls to happen far apart in time (bad for Claude's prompt-caching
economics) when the actual usage pattern would let them run close together instead.

Two related, smaller problems surfaced while designing the fix:

1. **`job_leads.status`'s `'screening'` enum value already exists but has never been wired to anything** —
   it's referenced in `components/roleproof/kit.tsx` (`COMPLETED`, `STAGE_PILL`, `rpNextAction`) and
   `lib/ui.ts` (`STATUS_META`) as an in-progress marker, but nothing in `runScreening` ever sets it. It was
   evidently built for exactly this kind of async, multi-step run and never finished.
2. **B4 already asks the model for "Key Patterns & CV Tailoring Notes" and throws the answer away.**
   `lib/llm/schemas.ts`'s `B4.zod`/`B4.tool` (line 108) includes a `notes: z.string().nullable().optional()`
   field, and `systemPromptFor('B4', ownerId)` (`lib/prompts.ts` line 56) feeds the model the *entire*
   `Process/B4. Translate Requirements to Areas of Expertise and Define JD Groups.md` note verbatim as the
   cacheable system prompt — including its explicit instruction (§B, step 3): **"Write Key Patterns and CV
   Tailoring Notes (2–4 sentences maximum)"**, format "Lead with the dominant CV theme, then name 2–3
   specific tailoring priorities" (§D.1). So the model is almost certainly already producing this text on
   every live B4 call. But `lib/pipeline/screening.ts`'s B4 block only writes
   `{ skillRatings, jdGroupPrimary, jdGroupSecondary, atsSystem }` to `job_leads` — `r.data.notes` is read
   off the response and never persisted anywhere. `job_leads.key_patterns` exists as a column
   (`lib/db/schema.ts` line 283) but is populated only by the one-time SharePoint import
   (`scripts/seed.ts` line 364, reading column 29 of the legacy `Job Hunting Lists.xlsx`) — every lead
   captured since the app went live has an empty `key_patterns`, not because the model isn't producing the
   text, but because the write path drops it. Note: `Job Hunting Lists.xlsx` isn't in this repo (checked —
   it's on OneDrive), so this CI can't pull verified real historical examples of what past "Key Patterns"
   text looked like; the format rule above is sourced directly from the B4 process note, not fabricated.

This CI was scoped across a multi-session chat (2026-07-26 through 2026-07-28) that produced a full design
doc with mockups — see §3. That doc covers two parts; **this CI is Part 1 only** (the B-phase/scoring
orchestration). Part 2 (Monitoring/Applications, Archive) is D-phase work with its own existing stub note
(`Process/Development/D1. Monitoring Applications.md`) and is deliberately deferred to its own CI — same
reasoning the `Migrate LLM Provider` CI used to defer this Scoring Queue redesign in the first place
(see that CI's §2.0 Out-of-scope). Don't pull Part 2 into this pass.

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:**
- New `job_leads.status` values: `scoring_queue`, `selected`, `roadblocked`, `misaligned`. Reuse of the
  existing-but-dead `screening` value as the transient "B4–B6 in flight" marker.
- Split `lib/pipeline/screening.ts`'s `runScreening` into `runInitialChecks` (B1+B2+B3), `runScoring`
  (B4+B5+B6), and a new `refreshFreshness` (B1 only, for re-screening a lead already sitting in the queue).
  `runScreening` stays as a thin back-compat wrapper.
- Auto-fire `runInitialChecks` at capture time (`lib/pipeline/capture.ts`).
- Auto-select clean leads (no roadblocks, no misalignments) straight to `selected` — no manual triage click.
- Fix the B4 `notes` → `job_leads.key_patterns` persistence gap.
- New Scoring Queue UI: **Queue** (flagged leads only, inline Roadblocked/Misaligned/Selected + expandable
  JD text + key patterns), **Ready to score** (batch list + sequential runner + stuck-lead retry), plus
  relabeled actions on the existing **Results** view (`Tailoring CV`, `Application sent`).
- Feature flag `nextScoringQueue` per the existing `lib/env.ts` convention.

**Explicitly out of scope (do not implement in this pass):**
- Part 2 of the design doc — Monitoring/Applications list, Archive, drag-and-drop email capture, the
  decline pop-up. Separate CI, filed against `Process/Development/D1. Monitoring Applications.md`.
- `lib/llm/client.ts`, `lib/prompts.ts`, model routing — untouched, per the original brief for this whole
  redesign effort.
- Live Microsoft Graph mailbox links, `.msg`/`.eml` auto-parsing, Vercel Cron auto re-screening — all
  flagged as phase-2 ideas in the design doc, not required here.
- A stats/analytics view over `roadblocked`/`misaligned` throughput — earmarked as a future CI, not this one.

### 2.1 Current state (for reference — don't rediscover this)

- `lib/db/schema.ts` line 31: `leadStatusEnum = pgEnum('lead_status', ['captured', 'screening', 'hold',
  'screened', 'promoted', 'tailoring', 'ready', 'applied', 'archived'])`. Never altered since
  `drizzle/0000_slim_toro.sql` — no `ADD VALUE` precedent anywhere in `drizzle/*.sql` to copy from.
- `lib/pipeline/screening.ts`: `runScreening(leadId, ownerId?)` runs B1 (code) → B2 → B3 → B4 → B5 → B6
  sequentially, single function, triggered on demand for one lead via `runScreeningAction`
  (`app/actions/pipeline.ts`). `shouldHold(lead.postedDays)` is computed twice — once in the B1 block
  (band display only), once again in the B6 block, where the *final* `status: hold ? 'hold' : 'screened'`
  write actually happens. So today, B2–B6 all run even on a posting B1 already knows is stale — the hold
  gate is cosmetic, not a real short-circuit.
- `docs/PIPELINE.md`'s own flow diagram already documents the gate as a real short-circuit
  (`B1 → G1{≥60 days old?} → (no) → B2`) — the code doesn't match its own docs yet; this CI is what makes
  it match.
- `lib/pipeline/capture.ts`'s `createLead()` already does one inline LLM call (A1 extraction) synchronously
  inside the request, wrapped in try/catch so a failure never loses the captured lead — the precedent for
  adding `runInitialChecks` the same way.
- No `maxDuration` export or `vercel.json` anywhere in the repo. Current published Vercel limits (checked
  2026-07-28, see §3): Hobby `maxDuration` configurable 1–60s (30s default if unset), Pro up to 300s,
  "Fluid Compute" extends Hobby to 300s too. A hard-killed function returns `504
  FUNCTION_INVOCATION_TIMEOUT` with no in-process cleanup hook — whatever DB writes already committed stay
  committed, the rest doesn't happen.
- `app/actions/pipeline.ts`: `runScreeningAction`, `promoteLeadAction`, `toggleTargetAction`. No bulk/batch
  action exists anywhere in the codebase today — grepped for `draggable`/`onDrop`/`bulk`/`selectedIds`,
  no matches.
- `components/roleproof/weekly-triage.tsx` + `app/actions/triage.ts` implement an unrelated existing
  feature called **"Weekly Triage" (R5)** — a capacity-based ranking of leads already past scoring, for
  deciding what to tailor this week. Naming the new B2/B3 gate "Triage" as a UI destination would collide
  with this; the design resolved this by keeping "triage" as the interaction verb only (three inline
  buttons), not a tab name.
- `app/roleproof/page.tsx` line 46: `const active = leads.filter((l) => l.status !== 'archived')` — the
  only status currently excluded from the main board. `roadblocked`/`misaligned` need the same treatment.
- `app/dashboard/page.tsx`: `FUNNEL` (line ~43) and `STAGE_ORDER` (line ~51) are hand-maintained arrays
  keyed by status string — `FUNNEL`'s "Screened" bucket sums `screened + hold` today; new statuses will
  silently vanish from both unless added.
- `lib/llm/schemas.ts` line 108–136: `B4.zod`/`B4.tool` — see §1, the `notes` field exists and is asked
  for, just not persisted.

### 2.2 Target state

**A. Status enum**

```ts
export const leadStatusEnum = pgEnum('lead_status', [
  'captured', 'hold', 'scoring_queue', 'roadblocked', 'misaligned', 'selected',
  'screening', 'screened', 'promoted', 'tailoring', 'ready', 'applied', 'archived',
]);
```

Four new values (`scoring_queue`, `roadblocked`, `misaligned`, `selected`); `screening` already exists,
now actually gets set. No separate gate column (considered mirroring `requirementTailoring.approvalStatus`'s
shape — rejected: that gate is per-*row* (many requirement rows per lead); this gate is per-*lead*, and
`job_leads.status` is already the one field every consumer in this codebase keys off
(`rpNextAction`/`STAGE_PILL`/`COMPLETED`/the board's `active` filter) — a second parallel column would need
every one of those to check two fields instead of one for no benefit). Optional: add
`triaged_at: timestamp` for provenance symmetry with `requirementTailoring.approvedAt` — nice-to-have, not
required.

**B. Pipeline split — `lib/pipeline/screening.ts`**

```ts
export async function runInitialChecks(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  // B1 (unchanged code): freshnessBand, saturationBand, shouldHold — computed ONCE here, not deferred.
  if (hold) {
    await db.update(jobLeads).set({ freshnessBand, saturationBand, status: 'hold' })...;
    return [b1Report]; // B2/B3 skipped — real short-circuit now, matching docs/PIPELINE.md's own diagram
  }
  // B2 (unchanged) + B3 (unchanged) — same runStructured calls as today, verbatim.
  const clean = r2.data.roadblocks.length === 0 && r3.data.misalignments.length === 0;
  await db.update(jobLeads).set({ status: clean ? 'selected' : 'scoring_queue' })...;
  return [b1Report, b2Report, b3Report];
}

export async function runScoring(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  await db.update(jobLeads).set({ status: 'screening' })...; // transient, per-lead marker — now used for real
  // B4 (unchanged, but see §2.2.C for the notes-persistence fix) + B5 (unchanged) + B6 (unchanged),
  // including B6's own final status write (hold | screened), which stays as-is.
  return [b4Report, b5Report, b6Report];
}

/** B1-only refresh — deliberately NOT the same as runScreening. See §1: only B1's inputs
 *  (elapsed time, hold threshold) can meaningfully change after capture; B2–B6 are judgments
 *  over static JD text and re-running them just re-spends LLM calls for the same answer. */
export async function refreshFreshness(leadId: string, ownerId?: string | null): Promise<StepReport> {
  // Recompute freshnessBand/saturationBand/hold from today vs. the original capture.
  // Only force a status change if the lead is still at `scoring_queue` (pre-triage) — a lead already
  // `selected`/`screening`/`screened` keeps whatever human decision was made; refreshing just updates
  // the displayed freshness badge, never silently overturns a decision already taken.
}

/** Back-compat: unchanged call sites (scripts, tests, any "run everything" fallback) keep working. */
export async function runScreening(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  const initial = await runInitialChecks(leadId, ownerId);
  if (initial.some((r) => r.step === 'B1' /* held */)) return initial;
  const scoring = await runScoring(leadId, ownerId);
  return [...initial, ...scoring];
}
```

The B1–B6 bodies themselves (LLM calls, Zod validation, scoring math, `recordRun`) do not change — this is
a control-flow split plus the one-line auto-select addition, not a rewrite of step logic.

**C. Fix the B4 `notes` → `key_patterns` gap**

In `runInitialChecks`... no — B4 lives in `runScoring` (§2.2.B). In that block's
`db.update(jobLeads).set({...})` call, add `keyPatterns: r.data.notes ?? lead.keyPatterns` (preserve
existing value — e.g. a legacy-imported one — if this particular live call returns null). One line. This
alone makes the "Key Patterns & CV Tailoring Notes" text start flowing for every lead scored from here on,
with zero prompt changes needed (the instruction is already in the live system prompt via
`Process/B4...md`). Optional, low-risk improvement while touching this block: give the `notes` field in
`B4.tool`'s `input_schema` an explicit `description` matching the process note's instruction verbatim
("2–4 sentences: lead with the dominant CV theme, then name 2–3 specific tailoring priorities") — today the
field has no per-field description in the tool schema, only in the full step note; both currently reach the
model since the whole note is in the system prompt, so this is a belt-and-suspenders clarity improvement,
not a fix for a broken behavior.

**D. Capture-time hook — `lib/pipeline/capture.ts`**

At the end of `createLead()`, after the existing company/city/remote/formatSignals update, add:
```ts
try { await runInitialChecks(row.id, ownerId); }
catch (err) { console.error(`[capture] runInitialChecks failed for lead ${row.id}: ...`); }
```
Same style as the existing A1 extraction call immediately above it: awaited, best-effort, swallowed on
error — a failure just leaves the lead at `captured`, and the existing `rpNextAction('captured') →
"Screen"` board affordance is the unchanged manual fallback. Per §2.1's sourced Vercel numbers, no
`maxDuration` change is likely needed (three extraction-tier Sonnet calls comfortably fit even the
unconfigured Hobby default) — verify against the actual project's plan/settings before shipping rather than
assume; add `export const maxDuration = 30` to `app/api/ingest/route.ts` if it turns out to be needed.

**E. Queue tab — flagged leads only**

New route `app/roleproof/scoring-queue/page.tsx`. Query: `status = 'scoring_queue'` (plus `hold` leads,
shown flagged-not-blocking). This is now genuinely "only leads that need a human decision" — clean leads
never appear here at all (they auto-advanced to `selected` in §2.2.B). Each row:
- Title/company/city.
- Roadblock/misalignment chips — reuse the existing chip rendering in
  `components/roleproof/workspace.tsx`'s "Watch-out" section, don't invent new styling.
- **Expandable "Show full job description"** revealing raw `jdText` inline — lets Reggie sanity-check a
  flag against the actual posting before deciding, without navigating away.
- **`key_patterns` line, when present** (populated going forward per §2.2.C; blank for pre-fix leads).
- Three inline buttons: Roadblocked / Misaligned / Selected, wired to a new
  `setScreeningGateAction(leadId, status)` in `app/actions/scoring-queue.ts` (owner-scoped update,
  `revalidatePath`, mirroring `setApprovalAction`'s shape in `app/actions/tailoring.ts`).

**F. Ready to score tab — batch list + runner**

Query: `status = 'selected'` (auto- or manually-selected, no distinction needed in the query, though a
small "auto · clean" vs "manual override" badge is a nice-to-have per the mockups). "Run scoring · N leads"
button; client-side handler loops **sequentially** (not `Promise.all`) over the ids:

```ts
async function runBatch(ids: string[]) {
  for (const id of ids) {
    setRowStatus(id, 'running');
    try { await runScoringAction(id); setRowStatus(id, 'done'); }
    catch (e) { setRowStatus(id, 'error'); }
  }
  router.refresh();
}
```

Sequential is deliberate, not incidental — it's what gives tight, seconds-apart timing between calls,
which is what actually earns a better prompt-cache hit rate on B4–B6's system prompts (1h TTL) than
today's one-lead-at-a-time-across-hours pattern. This is also why clean leads were auto-selected *into*
this batch in §2.2.B rather than run through to B6 individually at capture time — running them alone would
reproduce the same cold-cache problem B2/B3 already accept at capture time, for steps where it's avoidable.

**Stuck-lead handling.** `runScoring` sets `status: 'screening'` before B4 starts; a hard Vercel kill
mid-batch (§2.1) can leave a lead stuck there — invisible to both this tab and Results. Mitigation:
1. Retrying is safe by construction — B4/B6 simply overwrite columns, B5 already skips re-extraction when
   `job_requirements` rows exist — so `runScoring(leadId)` can just be called again from the top.
2. Surface it: flag any row where `status = 'screening'` and `updatedAt` is more than ~2 minutes old with a
   visible "stuck — retry?" action in this tab, same "nothing rots silently" instinct the existing Weekly
   Triage held-pile already applies to stale postings.

**G. Results tab — relabeled actions (no new route)**

The existing Results view stays; only the per-row action label changes: `Tailoring CV` while
`status = 'tailoring'`, and once `status = 'ready'`, `Application sent` (a combined manual-confirm /
drop-target control — full detail is Part 2's scope; this CI only needs the label/state change on Results
itself, not the drop mechanic).

**H. Ripple — every place `LeadStatus` is enumerated**

| File | Change |
| --- | --- |
| `lib/db/types.ts` | Add 4 values to the `LeadStatus` union |
| `lib/ui.ts` | `LeadStatus` union, `STATUS_META` (new entries — `scoring_queue`/`selected` → `stage: 'screen'`; `roadblocked`/`misaligned` → treated like `archived`), `STATUS_ORDER` |
| `components/roleproof/kit.tsx` | `COMPLETED`, `STAGE_PILL`, `rpNextAction` — new cases for all 4 new values |
| `app/roleproof/page.tsx` | `active` filter extended to also exclude `roadblocked`/`misaligned`; "Needs you" focus entry now points at Queue's flagged-only count, not "everything captured" |
| `app/dashboard/page.tsx` | `FUNNEL`/`STAGE_ORDER` (§2.1) need `scoring_queue`/`selected` added or they silently undercount "in play" |
| `lib/env.ts` | `nextScoringQueue: str('NEXT_SCORING_QUEUE', '1') !== '0'`, same convention as `nextTriage` |

**I. Migration mechanics**

The enum has never been altered since `drizzle/0000_slim_toro.sql` — no `ADD VALUE` precedent in this
repo's history. `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction as a statement that
*reads* the new value; `drizzle-kit generate`'s `--> statement-breakpoint` convention already handles this
correctly — don't hand-edit the generated SQL to combine statements. **Deploy the migration before
deploying the code** that writes the new values.

**J. Docs**

`docs/PIPELINE.md`'s flow diagram already shows the B1 gate as a real short-circuit (§2.1) — no diagram
change needed, just confirm the implementation now matches it. `docs/ARCHITECTURE.md` — add the
Queue/Ready-to-score split and the stuck-lead mitigation to whatever section discusses the existing
batch-duration risk table, since this is the concrete implementation of the mitigation that table already
prescribes.

### 2.3 Ordered implementation checklist

1. `lib/db/schema.ts`: add the 4 enum values; run `drizzle-kit generate`; inspect the output (four
   `ALTER TYPE ... ADD VALUE` statements, each on its own `statement-breakpoint`); apply via
   `scripts/migrate.ts` (or existing migration flow) **before** the next steps touch anything that writes
   the new values.
2. `lib/pipeline/screening.ts`: implement `runInitialChecks`, `runScoring`, `refreshFreshness`; keep
   `runScreening` as the back-compat wrapper (§2.2.B). Add the auto-select-clean-leads line. Fix the B4
   `notes` → `keyPatterns` write (§2.2.C).
3. `lib/pipeline/capture.ts`: fire `runInitialChecks` at the end of `createLead()` (§2.2.D).
4. `app/actions/pipeline.ts`: add `runInitialChecksAction`, `runScoringAction`, `refreshFreshnessAction`.
5. `app/actions/scoring-queue.ts` (new): `setScreeningGateAction`.
6. Ripple updates from §2.2.H (`lib/db/types.ts`, `lib/ui.ts`, `kit.tsx`, board/dashboard filters).
7. `components/roleproof/scoring-queue.tsx` (Queue — flagged list, inline triage, expand + key patterns)
   and `components/roleproof/ready-to-score.tsx` (batch list, sequential runner, stuck-lead retry) — new
   client components.
8. `app/roleproof/scoring-queue/page.tsx` (new route hosting both tabs) + nav link from the board.
9. Results view: relabel the row action per §2.2.G.
10. `lib/env.ts`: add `nextScoringQueue`; gate the new route/nav entry behind it.
11. Run `vitest` — should pass unchanged for anything not touched; add coverage for the auto-select rule
    and the B1 hold short-circuit specifically, since both are new branching logic.
12. Live smoke test: capture one clean lead (confirms auto-select → `selected` with no manual click) and
    one flagged lead (confirms it lands in Queue, triage buttons work) end to end through a batch
    "Run scoring" call; confirm `key_patterns` is populated on both after B4.
13. Update `docs/ARCHITECTURE.md` per §2.2.J.

### 2.4 Acceptance criteria

- A freshly captured lead with no roadblocks/misalignments reaches `status = 'selected'` with zero manual
  clicks; one with either reaches `status = 'scoring_queue'` and does not disappear until triaged.
- A lead whose B1 gate trips (`shouldHold`) reaches `status = 'hold'` **without** B2/B3 having run
  (verify via `pipeline_runs` — no B2/B3 rows for that lead until a manual "screen anyway").
- Running a batch of N `selected` leads produces N sequential (not concurrent) `runScoringAction` calls,
  each completing before the next starts, and every lead ends at `screened` or `hold`.
- Every lead scored after this ships has a non-null `job_leads.key_patterns` whenever B4's live response
  included `notes` (verify against `pipeline_runs.output` for the B4 step).
- A lead artificially left at `status = 'screening'` with a stale `updatedAt` shows the "stuck" affordance
  in Ready to score, and retrying it via `runScoringAction` completes normally.
- `roadblocked`/`misaligned` leads are excluded from `app/roleproof/page.tsx`'s `active` list, same as
  `archived`.
- `tsc --noEmit` clean; `vitest` passes.

## 3. Resources or references

- Design doc (the fuller spec this CI distills, including UI mockups discussed across the originating chat
  session): `docs/proposals/Scoring Queue - Implementation Plan.md` — Part 1 only; Part 2 is out of scope
  here (§2.0).
- Code: `lib/db/schema.ts`, `lib/db/types.ts`, `lib/ui.ts`, `lib/pipeline/screening.ts`,
  `lib/pipeline/capture.ts`, `lib/llm/schemas.ts` (B4 `notes` field), `app/actions/pipeline.ts`,
  `components/roleproof/kit.tsx`, `components/roleproof/workspace.tsx` (chip rendering to reuse),
  `app/roleproof/page.tsx`, `app/dashboard/page.tsx`, `lib/env.ts`.
- Process notes: `[[B1. Capture Posting Freshness and Market Saturation]]`,
  `[[B2. Identify Roadblocks]]`, `[[B3. Identify Misalignments]]`,
  `[[B4. Translate Requirements to Areas of Expertise and Define JD Groups]]` (§B step 3 and §D.1 are the
  source of the Key Patterns format rule used in §1/§2.2.C).
- Docs: `docs/PIPELINE.md` (B1 gate diagram, already correct), `docs/ARCHITECTURE.md` (batch-duration risk
  table this CI implements the mitigation for).
- Sibling CI (deferred scope, and the precedent for splitting this work into two CIs):
  `[[Migrate LLM Provider - DeepSeek to Claude (Sonnet 5 + Opus 4.8, Single Provider)]]` §2.0 explicitly
  named this Scoring Queue redesign as out of scope for that migration.
- Vercel Functions limits, checked live 2026-07-28 (not from memory — these have changed release to
  release): https://vercel.com/docs/functions/limitations — Hobby `maxDuration` 1–60s (30s default), Pro
  up to 300s, Fluid Compute extends Hobby to 300s.
- Model choice for the Claude Code implementation session (see §4 for the reasoning): Anthropic's own
  Opus 5 launch materials position Opus 5 as the default for complex agentic coding at roughly half
  Fable 5's cost, escalating to Fable only when a failure would be expensive —
  https://www.anthropic.com/news/claude-opus-5.

## 4. Notes / Progress log

- 2026-07-28: CI opened. Spec written across a multi-session chat (2026-07-26–28) that produced the fuller
  design doc + mockups referenced in §3, then iterated through two rounds of Reggie's line-by-line notes
  (interaction naming, the auto-select-clean-leads correction, the Vercel stuck-lead question, the
  re-screening scope correction, and the B4 key-patterns gap this session traced to a specific line in
  `lib/pipeline/screening.ts`). Distilled here into Part 1 only — Part 2 (Monitoring/Applications/Archive)
  deferred to its own CI against `Process/Development/D1. Monitoring Applications.md`, matching how the
  `Migrate LLM Provider` CI itself deferred this whole redesign in the first place.
- **Model recommendation for implementation: Claude Opus 5, not Fable 5.** Checked Anthropic's current
  guidance rather than assume: Opus 5 is positioned as the default choice for complex agentic coding and
  enterprise workflows, scoring ahead of Fable 5 on coding-specific agentic benchmarks while costing about
  half as much per task; Anthropic's own guidance is to reach for Fable only when a failure would be
  expensive, not as the default for this class of work. Separately, this repo's own closest precedent —
  the `Migrate LLM Provider` CI, comparable in surface area (client/schema/pipeline/env/migration/docs, a
  multi-file cross-cutting change) — was implemented successfully on Fable 5 back on 2026-07-24, the same
  day Opus 5 launched, so Fable wasn't a deliberate choice there so much as what was available at the time.
  That CI's own follow-up log entries are worth reading before starting this one: it hit two real issues
  (strict-tool-use schema limits on a 32-optional-field tool, and a `temperature` parameter Sonnet
  5/Opus 4.8 no longer accept) that a Claude Code session on this CI may run into again if it touches
  `B4.tool`'s schema (§2.2.C's optional description addition stays well under the strict-mode field-count
  ceiling that CI ran into, but worth having that log open for reference regardless).
- **`ci-estimated-time` corrected 18 → 4 (2026-07-28, same session).** The original number priced in
  Reggie's own review/testing time, not Opus's execution time — checked this repo's two closest precedents
  for actual agent runtime instead of guessing: `[[Requirement Skills vs My Skills - Two-Column Redesign
  (Epic)]]` (schema rename + pipeline rewiring across six steps + six prompt edits — comparably coupled)
  estimated 6h, spent 1.5h; `[[Migrate LLM Provider - DeepSeek to Claude (Sonnet 5 + Opus 4.8, Single
  Provider)]]` (client/schema/pipeline/env/migration/docs, no new UI) estimated 10h, spent ~2h. This CI has
  a similarly-shaped schema/pipeline change plus two genuinely new UI components neither precedent needed,
  so 4h (vs. their 1.5–2h) accounts for that extra surface while staying anchored to the same repo's
  observed velocity rather than an unmoored guess. Both precedents also needed a short follow-up round
  after the first pass surfaced something real — budget for that here too, not reflected in the 4h alone.
- **2026-07-28 · Steps 1–13 implemented.** Steps 1–10 landed across six commits (`2039db3`..`3d5b260`).
  Step 11 added `lib/__tests__/screening-gate.test.ts`, covering the two genuinely new branches — the
  auto-select rule (extracted as the pure `gateStatusFor(roadblocks, misalignments)` precisely so it
  could be unit-tested away from the DB) and `shouldHold`'s 60-day threshold, including the case that a
  held lead must never also be gated. Suite: **131 tests / 13 files green, `tsc --noEmit` clean.**
- **Step 12 · verification harness.** `scripts/verify-scoring-queue.ts` drives every §2.4 criterion
  against the real DB under a throwaway owner id (`…0ffff1`), building the exact clean/flagged/stale
  lead shapes each criterion needs rather than hoping real data contains them; it deletes everything it
  creates. **26 checks, 0 failures**, including the two that a unit test structurally cannot prove: that
  a held lead leaves `pipeline_runs` with a B1 row *and no B2/B3 rows* (the gate is a real
  short-circuit, not a cosmetic flag), and that the batch's N `runScoring` calls do not overlap in time.
  Also pinned down two behaviours the checklist implied but never stated: "screen anyway" is just
  re-running `runInitialChecks` after the hold reason is cleared, and `refreshFreshness` moves a
  pre-decision `scoring_queue` lead to `hold` but leaves an already-`selected` one alone.
- **Harness bug worth recording — forcing mock mode from inside a script does not work.**
  `verify-scoring-queue.ts` opened with `process.env.LLM_MODE = 'mock'` above its imports, which reads
  as correct and is not: **imports are hoisted above every statement**, so `lib/env.ts` — which
  snapshots `process.env` once at module scope into a frozen `env` const — had already read
  `LLM_MODE=live` from `.env.local` before that line ran. The harness was therefore making real
  Anthropic calls on every check, which is what produced the transient 500 that killed its first run
  mid-batch. Fixed by moving the assignment into `scripts/_force-mock.ts` and importing that first
  (import *order between modules* is preserved even though imports hoist above statements). Any future
  script that needs to pin an env var before `lib/env` loads must use the same trick. Re-run after the
  fix: deterministic, seconds instead of minutes, and free.
- **Step 12 · the one criterion mock cannot prove, checked live.** `mockSkillMapping` hardcodes
  `notes: null`, so the mock run only ever exercises the `?? lead.keyPatterns` preservation half of the
  §2.2.C write. `scripts/verify-key-patterns.ts` runs one throwaway lead live through B4–B6 and
  compares `job_leads.key_patterns` against the recorded `pipeline_runs.output.notes` for the B4 step —
  equality, not merely non-null. **4/4 passed.** This settles §1's central hypothesis with evidence
  rather than inference: the live B4 response carried **505 characters** of Key Patterns text, in
  exactly the format `Process/B4…md` §D.1 prescribes (dominant CV theme first, then three numbered
  tailoring priorities), confirming the model has been producing this all along and the write path was
  the only thing dropping it. No prompt change was needed, as predicted.
- **Step 13 · docs.** `docs/PIPELINE.md`'s G1 gate diagram needed no change (§2.2.J was right — the
  code now matches the docs rather than the reverse); added the two-halves explanation under §B and
  pointed B4's row at `job_leads.key_patterns`. `docs/ARCHITECTURE.md`: the "Vercel function duration
  on batch B6" risk row now records this CI as the concrete implementation of the mitigation it
  prescribed (N per-lead invocations client-driven, so a hard kill costs one lead not the run), plus a
  new row for the stuck-lead rule; the "one full lead lifecycle" block was rewritten around the split,
  since its step 2 still said screening starts with a "Screen" click that no longer exists.
- **Open for Reggie · not blockers.** (a) Everything above is verified at the function/DB layer; the
  Queue and Ready-to-score *surfaces* have not been click-tested in a browser, so step 12's "triage
  buttons work" is proven at the action layer only. (b) `key_patterns` stays empty on every lead
  captured before this ships — the fix is forward-only by design; a backfill would mean re-running B4
  on the whole history, which is a cost decision, not a code one.
