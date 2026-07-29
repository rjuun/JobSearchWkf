# RoleProof — Scoring Queue workflow redesign

Implementation plan for splitting B-phase screening into an automatic B1–B3 pass at capture time and a
user-triggered, batch B4–B6 scoring pass after manual triage. Grounded against the current code in
`lib/pipeline/screening.ts`, `lib/db/schema.ts`, `app/actions/pipeline.ts`, `components/roleproof/kit.tsx`,
`lib/ui.ts`, `lib/db/types.ts`, and `docs/ARCHITECTURE.md` / `docs/PIPELINE.md` as of 2026-07-26.

Out of scope: `lib/llm/client.ts`, `lib/prompts.ts`, model routing, and anything about which model scores a
step — this is purely about lead flow through B1–B6.

---

## 1. Status model changes

`lib/db/schema.ts` currently defines:

```ts
export const leadStatusEnum = pgEnum('lead_status', [
  'captured', 'screening', 'hold', 'screened', 'promoted',
  'tailoring', 'ready', 'applied', 'archived',
]);
```

Two things worth knowing before changing it:

- **`'screening'` already exists but is dead code.** It's wired into `COMPLETED`, `STAGE_PILL`, and
  `rpNextAction` in `components/roleproof/kit.tsx` (shows "Running…", not actionable) and into
  `STATUS_META` in `lib/ui.ts`, but nothing in the current pipeline ever sets a lead's status to it —
  `runScreening` runs straight through B1–B6 and only writes `hold` or `screened` at the very end. It was
  evidently built for an in-progress marker that was never wired up. This redesign finally gives it a job.
- **`docs/PIPELINE.md`'s own diagram already documents the B1 gate as blocking B2**, not just flagging
  after the fact: `B1 → G1{≥60 days old?} → (no) → B2`. The current code doesn't actually implement that —
  `runScreening` runs B2–B6 regardless and only decides `hold` vs `screened` after B6. This redesign is the
  point where the code catches up to what the docs already say it should do.

### New enum values

Add four: **`scoring_queue`**, **`selected`**, **`roadblocked`**, **`misaligned`**. Final set:

```ts
export const leadStatusEnum = pgEnum('lead_status', [
  'captured',       // just inserted, A1 extraction pending/running
  'hold',           // B1 gate: ≥60 days old — B2/B3 skipped, needs a manual decision
  'scoring_queue',  // B1(fresh) + B2 + B3 done — sitting for triage
  'roadblocked',    // triage: drop, terminal
  'misaligned',     // triage: drop, terminal
  'selected',       // triage: queued for the next batch scoring run
  'screening',       // B4–B6 in flight for this lead (now actually used)
  'screened',        // B4–B6 done — unchanged from today
  'promoted', 'tailoring', 'ready', 'applied', 'archived', // unchanged
]);
```

### Status flow

```
captured ──(A1 done)──▶ runInitialChecks (B1)
                            │
                 ≥60d old?  ├─ yes ──▶ hold ──(manual "screen anyway")──▶ scoring_queue
                            └─ no ───▶ B2 + B3 ──▶ scoring_queue
                                                        │
                                              (user triages one lead)
                                    ┌───────────────────┼───────────────────┐
                                    ▼                   ▼                   ▼
                              roadblocked          misaligned            selected
                               (terminal)           (terminal)               │
                                                                  (user runs batch scoring)
                                                                              ▼
                                                                        screening (transient, per lead)
                                                                              ▼
                                                                 hold | screened  (B1 re-check + B4–B6)
                                                                              ▼
                                                          promoted → tailoring → ready → applied → archived
```

### Why extend `status` rather than add a separate gate column

The architectural note suggested modelling this "the same way" as the C2 Keep/Maybe/Drop gate
(`requirementTailoring.approvalStatus`, a dedicated enum column, default `pending`). I looked at that
pattern closely and I'm recommending against copying it literally, for one structural reason: C2's gate is
a **per-row** decision (one of many `requirement_tailoring` rows per lead), so it *needs* its own column —
`job_leads.status` says nothing about any individual row. The Scoring Queue triage is a **per-lead**
decision, and `job_leads.status` is already the single thing every consumer in this codebase keys off:
`rpNextAction`, `STAGE_PILL`, `COMPLETED` (stage pips), the board's `active` filter, the "Needs you" focus
queue. Adding a second, parallel `screening_gate` column would mean every one of those call sites has to
remember to check two fields instead of one, and they'd need to stay in sync. Extending `status` keeps a
single source of truth and costs nothing — the *pattern* I'm carrying over from C2 is "a persisted enum,
default to an undecided state, one action sets it, only one outcome flows downstream," not the specific
choice of a separate column. Flagging this as a real decision, not a rubber-stamp — say if you'd rather
have the parallel-column version for some reason I'm not seeing (e.g. wanting to re-triage a dropped lead
without losing the terminal status).

No new reason-code column is needed either: `roadblocked` vs `misaligned` *is* the reason, and the detail
(which roadblock, which misalignment) already lives in the existing `roadblocks` / `misalignments` jsonb
columns populated by B2/B3.

### Optional: `triaged_at`

For symmetry with the provenance backbone already established on `requirement_tailoring.approvedAt`
("M7 — stamp only on transition into the terminal-ish state"), consider adding
`job_leads.triaged_at: timestamp`, set once when a lead first leaves `scoring_queue`. Not required for the
feature to work, but cheap, and gives you "how long did this sit in the queue" for free later. Your call.

### Ripple: every place `LeadStatus` is enumerated

Adding enum values means touching the mirrors of that union, not just the DB enum:

| File | Change |
| --- | --- |
| `lib/db/schema.ts` | Add the 4 values to `leadStatusEnum` |
| `lib/db/types.ts` | Add to the `LeadStatus` union |
| `lib/ui.ts` | Add to `LeadStatus` union, `STATUS_META` (label/tone/bar/stage — `scoring_queue`/`selected` → `stage: 'screen'`, `roadblocked`/`misaligned` → `stage: 'archived'`-equivalent), `STATUS_ORDER` |
| `components/roleproof/kit.tsx` | `COMPLETED` map, `STAGE_PILL` map, `rpNextAction` switch (new cases: `scoring_queue` → "Triage", `selected` → "Ready to score", `roadblocked`/`misaligned` → not actionable) |
| `app/roleproof/page.tsx` | `active` filter currently excludes only `archived` — extend to also exclude `roadblocked`/`misaligned` from the main board (they're terminal drops, same as archived), and add a "Needs you" focus entry for `scoring_queue` leads pointing at the new queue page |
| `app/dashboard/page.tsx` | Has a hardcoded stage list including `'screening'` — check whether `scoring_queue`/`selected` need an entry there too |

### Migration mechanics

The enum has never been altered since `drizzle/0000_slim_toro.sql` — every value was baked in at creation,
so there's no `ADD VALUE` precedent in this repo's migration history to copy from. Two things to watch:

1. `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction as a statement that *reads* the new
   value (Postgres restriction). Drizzle-kit's generated migrations already use
   `--> statement-breakpoint` to split statements, which handles this correctly as long as you don't
   hand-edit the generated SQL to combine steps.
2. **Deploy the migration before deploying the code** that writes `scoring_queue` / `selected` /
   `roadblocked` / `misaligned` — an enum value must exist before any `INSERT`/`UPDATE` references it.

Run `drizzle-kit generate` after editing the schema, inspect the output SQL (should be four
`ALTER TYPE "public"."lead_status" ADD VALUE 'x'` statements), then `drizzle-kit migrate` (or your existing
`scripts/migrate.ts`) against the DB before shipping the app code.

---

## 2. Pipeline split — `lib/pipeline/screening.ts`

Current `runScreening(leadId, ownerId?)` runs B1→B2→B3→B4→B5→B6 as one function. Split it into two
exported functions plus keep the original as a thin wrapper so nothing that already calls `runScreening`
directly (scripts, tests, a manual "run everything" fallback) breaks:

```ts
export async function runInitialChecks(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  // B1 (unchanged code) — freshness/saturation/hold, exactly as today's B1 block.
  // NEW: this is now a real gate, not just a status flag decided at the end.
  if (hold) {
    await db.update(jobLeads).set({ freshnessBand, saturationBand, status: 'hold' })...
    return [b1Report]; // B2/B3 skipped — don't spend LLM calls on a likely-stale posting
  }
  // B2 (unchanged) + B3 (unchanged) — same runStructured calls as today, verbatim.
  await db.update(jobLeads).set({ status: 'scoring_queue' })...
  return [b1Report, b2Report, b3Report];
}

export async function runScoring(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  await db.update(jobLeads).set({ status: 'screening' })...  // transient, per-lead marker
  // B4 (unchanged) + B5 (unchanged) + B6 (unchanged) — same blocks as today, verbatim,
  // including B6's own final status write (hold | screened) which stays as-is.
  return [b4Report, b5Report, b6Report];
}

/** Back-compat: still available for scripts/manual full-pipeline runs. */
export async function runScreening(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  const initial = await runInitialChecks(leadId, ownerId);
  if (initial.some(r => r.step === 'B1' && /* held */)) return initial;
  const scoring = await runScoring(leadId, ownerId);
  return [...initial, ...scoring];
}
```

The B1–B6 bodies themselves (LLM calls, Zod validation, scoring math, `recordRun`) don't change — this is
a control-flow split, not a rewrite of any step's logic. Re-verify the exact hold-check placement against
the code at build time; today's `shouldHold` is computed twice (once in the B1 block for band display,
once again at B6 for the final status write) — the initial-checks version should compute it once and act
on it immediately rather than deferring the decision to B6.

### Re-screening is not the same thing as re-running `runScreening`

Caught a real mistake here: I'd left "re-screening" implicitly pointing at the `runScreening` back-compat
wrapper above, which redoes the *entire* B1–B6 pipeline. That's wrong. What re-screening actually means —
checking a lead you've been sitting on for a while for anything that could genuinely have changed — is
narrower: **only B1 has a reason to re-run.** `postedDays`/`applicantCount` are a snapshot parsed at
capture time from text that doesn't change; what's actually stale is *how much time has passed since that
snapshot*, and whether the posting has since crossed the 60-day hold threshold. B2's roadblocks, B3's
misalignments, and (once scored) B4–B6 are all judgments over the JD text itself, which hasn't changed —
re-running them against unchanged input just burns LLM calls to get the same answer back.

So this needs its own function, not reuse of the back-compat wrapper:

```ts
export async function refreshFreshness(leadId: string, ownerId?: string | null): Promise<StepReport> {
  // Recompute freshnessBand / saturationBand / hold from today's date vs. the original capture,
  // NOT a re-parse of the same static jdText. B2/B3/B4/B5/B6 are untouched.
  // Only forces a status change if the lead is still pre-triage (scoring_queue) — a lead already
  // `selected`, `screening`, or `screened` keeps its human decision; re-screening just refreshes the
  // freshness/saturation badge shown alongside it, doesn't silently overturn a decision already made.
}
```

Surfaced as a manual "Re-screen" action (distinct from "Screen anyway") on any pre-Results lead that's
been sitting a while — a scheduled/automatic recheck is a reasonable v2 (Vercel Cron), not needed to ship
this.

### `app/actions/pipeline.ts`

Add `runInitialChecksAction(leadId)` and `runScoringAction(leadId)` alongside the existing
`runScreeningAction`, following the same shape (owner-scoped fetch, JD-length guard, `recordActivity`,
`revalidatePath`). `runScoringAction` is the one the batch UI calls once per selected lead.

---

## 3. Capture-time hook — firing B1–B3 automatically

`lib/pipeline/capture.ts`'s `createLead()` already does one inline LLM call (A1 extraction) synchronously,
wrapped in try/catch so a failure never loses the captured lead — that's the precedent to follow, not a new
pattern. Add the call to `runInitialChecks(row.id, ownerId)` at the end of `createLead()`, same style:
awaited, best-effort, swallowed on error (a failed auto-run just leaves the lead at `captured`, and the
existing board affordance — `rpNextAction('captured') → "Screen"` — becomes the manual fallback, unchanged).

**Real risk to check before building this, not to assume away:** `/api/ingest` and `createLeadAction` would
now make up to 4 sequential LLM calls in one request (A1 + B1-code + B2 + B3) instead of 1. I didn't find a
`maxDuration` export or `vercel.json` anywhere in the repo, meaning both routes currently run on whatever
Vercel's plan default is. Checked the current published limits rather than go from memory, since Vercel has
changed these more than once: **Hobby's `maxDuration` is configurable 1–60s (Vercel's own default is 30s if
unset); Pro can go up to 300s; "Fluid Compute" can extend Hobby to 300s too** ([Vercel Functions
limits](https://vercel.com/docs/functions/limitations)). So the ceiling is friendlier than I'd assumed —
three extraction-tier Sonnet calls at a few seconds each fits comfortably even on an unconfigured Hobby
default. Two mitigations, pick one after checking the actual plan/config:

- **Preferred if the plan allows it:** add `export const maxDuration = 30;` (or whatever headroom you want,
  within the ceiling above) to `app/api/ingest/route.ts` and the `createLeadAction` server action's route.
  Simplest, no architecture change, and single-lead calls are exactly the case Vercel's duration limit is
  *not* the documented risk for (that risk is specifically the batch B6 case in `docs/ARCHITECTURE.md`'s
  risk table).
- **If stuck on a hard ceiling anyway:** return the lead id from `/api/ingest` immediately after the insert
  (before A1 even runs), and have the client (capture page / bookmarklet) fire a second request to a new
  tiny endpoint that runs A1 + `runInitialChecks` after the redirect. More moving parts for a problem you
  may not actually have — check the Vercel plan/config first.

This is unrelated to the batch-scoring duration risk the architecture doc already covers — that one's
about looping over *many* leads in one function; this is one lead, up to 4 calls, and the existing A1 call
already sets the "average duration is fine, verify the ceiling" precedent.

**What actually happens if the ceiling is hit mid-call, not just "it times out":** Vercel kills the function
process outright and returns a `504 FUNCTION_INVOCATION_TIMEOUT` to the caller — there's no in-process
cleanup hook, no chance for a `finally` block to run after the platform itself pulls the plug. Whatever DB
writes had already committed before the kill stay committed; whatever hadn't, didn't. On the ingest path
this is low-stakes: worst case, A1 or B1–B3 partially ran and the lead sits at `captured` — the existing
"Screen" fallback picks it up manually, nothing is lost. It matters more for the batch-scoring path — see
the stuck-lead note in §4.

---

## 4. Scoring Queue UI

New route: `app/roleproof/scoring-queue/page.tsx`, linked from the board (`app/roleproof/page.tsx`) both
as a nav entry and as a "Needs you" focus card once ≥1 lead needs a triage decision (defined narrowly now
— see below). Naming note: the codebase already has an R5 feature called **"Weekly Triage"**
(`components/roleproof/weekly-triage.tsx`, `app/actions/triage.ts`) which is unrelated — it's a
capacity-based ranking of leads already past scoring, for deciding what to tailor this week. Recommend
naming the route/components around **"Scoring Queue"** specifically so grep and code review don't conflate
the two features. **Confirmed naming, closing the loop on the question the interactive tool failed to
deliver (it errored out, so thank you for answering it directly in your notes instead):** Triage folds into
Queue rather than staying a separate tab; the batch-scoring tab is **"Ready to score"**; the Flow is now
**Queue → Ready to score → Results → Applications**, with **Archive** as the sibling reference tab from
Part 2.

### Only flagged leads actually need a human decision

Real correction to the original design, not a refinement: requiring a Roadblocked/Misaligned/Selected click
on *every* lead — including the ones where B2 and B3 both come back empty — was manufacturing a decision
where there isn't one. A clean lead has nothing to evaluate; forcing a click on it is exactly the kind of
friction this whole redesign exists to remove. So:

- A lead with `roadblocks = []` **and** `misalignments = []` after `runInitialChecks` gets **auto-set to
  `selected`** the moment B2/B3 finish — no manual step at all.
- A lead with *any* roadblock or misalignment flag lands in `scoring_queue` and genuinely waits for you —
  this is now the *only* thing the Queue tab shows. Its badge count becomes a real "needs you" signal
  (only flagged leads), not "everything captured today," which is a better fit for the app's existing
  "needs you" philosophy than the original all-leads version was.

This also directly answers the question you raised about running clean leads straight through to B6
instead of parking them: **don't** — there's a real token-economy reason not to, not just inertia. Claude's
prompt caching (already in place per the LLM migration — 1h TTL `cache_control` breakpoints on each step's
system prompt) only pays off when calls land close together; a lead that runs B4–B6 the instant it's
captured, in isolation, gets the same cold cache-write every time a fresh capture happens to trigger it —
exactly the "lower, less predictable cache-hit rate" already called out for B2/B3 firing at capture time,
now spreading to B4–B6 too if clean leads skip the batch. Auto-selecting clean leads *into* the batch (so
they still wait for "Run scoring" alongside whatever you manually selected) keeps them inside the tight,
seconds-apart batch window that actually earns the better cache-hit rate — you get the friction removed
and keep the token economics. Worth checking after this ships whether the hit-rate improvement is real in
your actual Anthropic usage dashboard, since this is a prediction, not something I can verify from the
codebase alone.

Auto-selecting isn't the same as auto-*deciding*, though — you can still catch something B2/B3 missed. So
triage stops being a screen you visit and becomes **three inline buttons attachable to any pre-scoring
lead row**, wherever it's shown — a flagged row in Queue, or an auto-selected clean row in Ready to score.
Every row, flagged or clean, gets:

- **An expandable "Show full job description"** revealing the raw `jdText` inline, so you have the actual
  posting in front of you before overriding a flag or double-checking a clean auto-selection — not a
  navigation away from the list.
- **The `key_patterns` field, when present.** Checked this in the codebase: `job_leads.key_patterns` exists
  in the schema but is populated only for leads imported from the old SharePoint reconciliation
  (`scripts/seed.ts` reads it from column 29 of the legacy sheet) — no current B-step writes it for newly
  captured leads. I'll render it when it's there and leave it blank otherwise, but I genuinely don't know
  what it's meant to represent going forward for new leads (which step should generate it, and what
  pattern it's supposed to capture) — rather than guess and risk fabricating a meaning for a field you
  clearly have a specific memory of, tell me what it should hold and I'll wire a real step to produce it.

Roadblocked / Misaligned / Selected still write through `setScreeningGateAction(leadId, status)` in a new
`app/actions/scoring-queue.ts`, mirroring `setApprovalAction`'s shape in `app/actions/tailoring.ts`
(owner-scoped update, `revalidatePath`).

**List view** — leads with `status = 'scoring_queue'` (flagged, awaiting your decision) plus `hold` leads
(informational, not blocking — B1–B3 already ran for them if you use "screen anyway"), each row showing
title/company/city and roadblock/misalignment chips (reusing the existing `roadblocks`/`misalignments` chip
rendering already in `components/roleproof/workspace.tsx`'s "Watch-out" section), the expand toggle and
key-patterns line above, and the three inline triage buttons.

**Ready to score** — leads with `status = 'selected'`, whether they got there by your click or by the
auto-select rule above, plus a "Run scoring · N leads" button. Client-side handler loops sequentially over
the ids, calling `runScoringAction(id)` per the ARCHITECTURE.md mitigation (N calls to the existing
per-lead action from the client, not a new server-side loop), updating a small per-lead status indicator
(queued → running → done) exactly the way `workspace.tsx`'s existing `onScreen()`/`onMap()` handlers already
drive their own busy-step UI — same pattern, just looped:

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

Sequential (not `Promise.all`) is deliberate here, not just a duration-safety habit — it's also what gives
you the tighter, more predictable timing between calls that the caching note above is counting on for a
better cache-hit rate on B4–B6's system prompts than today's one-lead-at-a-time-across-hours pattern
produces. Parallel would remove that benefit for no real speed win, since each call still has to complete
regardless of order.

**The one real failure mode here, and what to do about it:** you asked what happens if Vercel stops mid-lead
and doesn't get through all of B6's work — worth answering precisely rather than "it's fine." `runScoring`
sets `status: 'screening'` *before* B4 even starts; if the platform hard-kills the function partway through
(§3's 504 mechanics — no cleanup hook runs), that lead can be left stuck at `screening` forever: not in
Ready to score anymore, never reached `screened` either, invisible to both lists. Two-part fix, both cheap:

1. **Retrying is safe, so make it obvious.** B4 and B6 simply overwrite columns; B5 already skips
   re-extracting when `job_requirements` rows exist. Re-invoking `runScoring(leadId)` from the top after a
   partial failure redoes at most a little already-completed work — it never corrupts or duplicates
   anything. So a stuck lead just needs a **retry** action, not a repair script.
2. **Detect "stuck," don't rely on noticing.** Flag any lead where `status = 'screening'` and `updatedAt` is
   older than a couple of minutes (comfortably past even a generous `maxDuration`) with a "this one looks
   stuck — retry?" affordance in Ready to score — the same "nothing rots silently" instinct the existing
   Weekly Triage's held-pile already applies to stale postings, just aimed at a different failure.

**Results view** — once the batch finishes, leads that were `selected` and are now `screened` (or `hold`,
if B1 re-flagged one mid-batch) get shown ranked by `overallFitScore` descending, reusing the existing
`RpScore` / `RpVerdictPill` components from `kit.tsx` rather than new score styling. Matches the board's
existing Proceed (≥7)/Borderline(≥5.5)/Hold thresholds so the color language stays consistent app-wide.

---

## 5. Feature flag

Every additive surface in this app ships behind a `lib/env.ts` flag (`nextThisWeek`, `nextTriage`,
`nextSourcingCompass`, etc.) — on by default, instantly retireable with `NEXT_*=0`. Add
`nextScoringQueue: str('NEXT_SCORING_QUEUE', '1') !== '0'` and gate the new route/board entries behind it,
consistent with how `env.nextTriage` currently gates the Weekly Triage strip.

---

## 6. Files touched (checklist)

| File | Change |
| --- | --- |
| `lib/db/schema.ts` | 4 new `lead_status` enum values; optional `triaged_at` column |
| `drizzle/00XX_*.sql` (generated) | `ALTER TYPE` migration |
| `lib/db/types.ts` | `LeadStatus` union |
| `lib/ui.ts` | `LeadStatus` union, `STATUS_META`, `STATUS_ORDER` |
| `lib/env.ts` | `nextScoringQueue` flag |
| `lib/pipeline/screening.ts` | Split into `runInitialChecks` / `runScoring`, keep `runScreening` wrapper; new `refreshFreshness` (B1-only re-screen, §2); auto-select-clean-leads rule lives at the end of `runInitialChecks` |
| `lib/pipeline/capture.ts` | Fire `runInitialChecks` at end of `createLead()`, try/catch |
| `app/api/ingest/route.ts` | Possibly `export const maxDuration` (§3 — likely unnecessary given the sourced Hobby ceiling, verify against your actual plan) |
| `app/actions/pipeline.ts` | `runInitialChecksAction`, `runScoringAction`, `refreshFreshnessAction` |
| `app/actions/scoring-queue.ts` (new) | `setScreeningGateAction` |
| `components/roleproof/kit.tsx` | `COMPLETED`, `STAGE_PILL`, `rpNextAction` — new status cases |
| `components/roleproof/scoring-queue.tsx` (new) | Queue list (flagged-only) with inline triage buttons + expandable JD/key-patterns |
| `components/roleproof/ready-to-score.tsx` (new) | Batch list + runner, including the stuck-lead retry affordance (§4) |
| `app/roleproof/scoring-queue/page.tsx` (new) | Route — Queue + Ready to score + Results as one page's tabs |
| `app/roleproof/page.tsx` | `active` filter, "Needs you" entry (now flagged-leads-only, not all captures), nav link |
| `app/dashboard/page.tsx` | `STAGE_ORDER` (line ~51) and the `FUNNEL` array (line ~43) are hand-maintained status lists — `FUNNEL`'s "Screened" bucket currently sums `screened + hold`; `scoring_queue`/`selected` leads would silently vanish from the funnel and undercount "in play" (`totalLeads - archived - applied`) unless added |

---

## 7. Open decisions for you

~~Resolved:~~ single `status` column over a parallel gate column (you're fine with it — noting the
re-triage concern I raised doesn't actually bite: moving a `roadblocked`/`misaligned` lead back to
`scoring_queue` to reconsider it is just another status update, no data loss, roadblocks/misalignments
stay in their own columns regardless). Tab naming: **Queue** (Triage folded in) → **Ready to score** →
**Results** → **Applications** (renamed from Monitoring, Part 2) + **Archive** sibling.

1. **Vercel `maxDuration` on the ingest path** — sourced current numbers in §3 make this look like a
   non-issue on any plan, but still worth a quick check against your actual project settings before
   shipping.
2. **What `job_leads.key_patterns` should actually contain for newly captured leads** (§4) — it's a
   legacy-import-only field today; tell me what it's meant to capture and I'll wire a real step to produce
   it, rather than guessing.
3. **Whether re-screening a lead that's already `selected`/`screened` should ever force a status change**
   (§2) — I defaulted to "no, only refresh the displayed freshness badge, never overturn a decision you
   already made" for anything past `scoring_queue`. Flag if you want re-screening to be able to pull an
   already-selected lead back to `hold` if it's gone sufficiently stale.

---

# Part 2 — Monitoring Responses (the D-phase)

**Revised after a second round of feedback** — the original draft had Interview Scheduled as its own
screen and a persistent "Decline + Reply" tab. Both changed below: Interview Scheduled now lives inside
the same Applications list as Response Pending (status + a few conditional columns tell them apart, not a
separate screen), and Decline + Reply is no longer a destination at all — it's a pop-up fired at the
moment a decline email is dropped. In its place, a genuinely missing piece: an **Archive** of Stopped
applications, kept outside the Flow tab group as a reference, not a pipeline stage. (The tab itself is
named **Applications**, not Monitoring — §4/nav; this part keeps the "Monitoring" section title since
that's the D-phase concept, matching `Process/Development/D1. Monitoring Applications.md`.)

Added after your note that Monitoring — already sketched in `Process/Development/D1. Monitoring
Applications.md` (currently just a frontmatter stub, no body) and previously run by hand in SharePoint —
needs to be built, not left as an idea. This closes the loop the Additive Plan left open: there's already
a `applications` table, a `markAppliedAction`, a `recordOutcomeAction`, and a "Returns" panel on
`/dashboard` (`components/roleproof/returns-panel.tsx`) that logs response/interview/offer/screened-out by
button click. Nothing here is greenfield — the job is to make that scaffold match your actual workflow
(drag-and-drop an email onto a lead, capture date + link, not a bare button click) rather than replace it.

## 2.1 Reading your flow back

You described the trigger for "Application sent" two ways in the same message — a button that becomes
available once tailoring is done, *and* something fulfilled by dropping the confirmation email. I'm
reading these as the same affordance described from two angles, and I built the mockups on that reading:
once a lead hits `ready` (CV tailored — `lib/pipeline/tailoring.ts`'s `generateCv()` already sets this),
its Results-tab action becomes a combined "Application sent" control that's *either* a drop target for the
confirmation email (auto-fills date + link) *or* a plain manual confirm if you don't have an email to drop
yet (e.g. you applied through a portal with no auto-reply). The same drop mechanic then repeats twice more
inside the Applications tab: drop a decline email → **Stopped**; drop an interview confirmation →
**Interview scheduled**. One interaction pattern, three places it fires. Flag if that's not actually what
you meant — in particular whether "Application sent" should be a single click with no drop option at all,
and the email only gets attached later.

## 2.2 Where this lives in the data model

`applications` (`lib/db/schema.ts`) already has one row per `(owner, lead)` — a unique index enforces that,
so this is a single evolving record per lead, not a log of every email. Its `status` is a plain `text`
column (not a Postgres enum like `lead_status`), gated in code by `ALLOWED_OUTCOMES` in
`app/actions/monitoring.ts`. That's the right extension point — cheaper than the enum surgery in Part 1,
since there's no `ALTER TYPE` involved, just widening a code-level set and adding nullable columns:

```ts
export const applications = pgTable('applications', {
  ...base,
  jobLeadId: uuid('job_lead_id').notNull(),
  cvVariantId: uuid('cv_variant_id'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),   // unchanged — "date it was sent"
  status: text('status'),                                        // unchanged column, new values below
  outcomeNotes: text('outcome_notes'),                            // unchanged
  confirmationEmailLink: text('confirmation_email_link'),         // NEW — sent-confirmation drop
  outcomeEmailLink: text('outcome_email_link'),                   // NEW — decline OR interview-confirmation drop
  outcomeAt: timestamp('outcome_at', { withTimezone: true }),     // NEW — date of that decline / "interview setup date"
  interviewAt: timestamp('interview_at', { withTimezone: true }), // NEW — the actual interview date/time (manual entry)
  thanksRepliedAt: timestamp('thanks_replied_at', { withTimezone: true }), // NEW — optional, "reply sent" marker
});
```

`outcomeEmailLink` and `outcomeAt` are deliberately dual-purpose rather than split into
`declineEmailLink`/`interviewConfirmationEmailLink` pairs — a lead can only be in one terminal-ish outcome
at a time (Stopped *or* Interview scheduled, never both), so one pair of columns covers it; the UI decides
which label to put on them based on `status`. `interviewAt` is the one field that's genuinely different in
kind from everything else here: it's a future fact (when the interview actually happens), not something
sitting in the dropped email's metadata, so it's a manual date/time entry next to the auto-filled "setup
date" (`outcomeAt`) — see §2.4. **Confirmed: renders as an actual date/time picker input**, not a
display-only field — the one field in this whole feature nobody drags in, it's always typed.

Only one genuinely new status value: **`response_pending`** — the state a lead enters the moment
"Application sent" fires, feeding the Applications list. Everything downstream reuses values
`ALLOWED_OUTCOMES` already has, just relabelled for this tab:

| Stored value | Existing meaning (Returns panel, retired §2.6) | New label (Applications list) |
| --- | --- | --- |
| `response_pending` (new) | — | **Response pending** |
| `screened_out` | "Screened out" | **Stopped** (moves to Archive, §2.5) |
| `interview` | "Interview" | **Interview scheduled** (stays in Applications, extra columns populate) |
| `offer` | "Offer" | Offer *(unchanged — not part of your ask, kept as a bonus bucket)* |

No data migration needed — existing rows keep meaning what they already mean, this only changes the label
map (`STATUS_LABEL` in `returns-panel.tsx`, plus wherever the new tab renders it) and adds one new value
going forward. `job_leads.status` itself does **not** grow new values for this — it stays at `applied`
(the existing coarse "applied" pipeline stage); response-pending / stopped / interview-scheduled are
sub-states of "applied" tracked on `applications`, not the lead's own stage. This mirrors how Part 1 treats
`job_leads.status` as the one thing the board keys off, and keeps this D-phase state where the existing D1
scaffold already put it.

### One list, not two — Applications now covers both open states

`response_pending` and `interview` rows both render in the same Applications list; only the status pill and
a few conditional columns differ. A `response_pending` row shows Sent date + confirmation link. An
`interview` row additionally shows **Interview setup date** (`outcomeAt` — when the confirmation itself
was logged), **Interview date** (`interviewAt` — the actual meeting, entered manually since it isn't in the
email's metadata), and **Interview confirmation email link** (`outcomeEmailLink`). `screened_out` rows
don't render here at all — they move straight to the Archive (§2.5) the moment that status is set, since
this tab is "still waiting on something," and a Stopped lead isn't.

### Navigation: Flow vs. reference

Updated for the confirmed naming (§ Part 1, section 4): the pipeline screens **Queue → Ready to score →
Results → Applications** (renamed from "Monitoring" — more concrete, plain job-search language) form one
tab group, **Flow**, since each is a stage a lead actively moves through. **Archive** sits outside that
group as a sibling, not a further stage — visually distinguished (a divider, a different tab treatment) so
it reads as "look back," not "keep working." This is the same distinction Part 1 already draws between the
active board (`status !== 'archived'`) and archived leads — Part 2 just gives that distinction its own tab
instead of leaving it implicit in a filter.

## 2.3 The drag-and-drop mechanic — and the one real risk in this whole addition

There's no drag-and-drop anywhere in this codebase today (checked — no `dnd-kit`/`react-dnd` dependency, no
`draggable`/`onDrop` usage anywhere). This would use plain HTML5 drag-and-drop (`draggable`, `onDragOver`,
`onDrop` + `dataTransfer`) — no new dependency needed for the mechanic itself.

The real open question is **what actually lands in `dataTransfer` when you drag an email out of your mail
client**, and that depends entirely on which client:

- Dragging from **classic Outlook desktop (Windows)** onto a browser window is well-documented to produce
  a real file drop — the OS hands the browser a temporary `.msg` file via `dataTransfer.files`.
- Dragging from **Outlook on the web (OWA) or the new Outlook app** is much less reliable for producing a
  usable file drop across window boundaries — some builds support "drag to desktop" as `.eml`, many don't
  drag cleanly into an arbitrary browser tab.
- Dragging **selected text or a copied link** instead of the message item itself lands in
  `dataTransfer.getData('text/plain')` / `'text/uri-list'` — no file at all.

I designed the drop target to be tolerant of all three rather than betting on one: whatever's in
`dataTransfer` gets captured (file → uploaded to Storage under `applications/{leadId}/{kind}-{ts}.msg`,
reusing the existing `lib/storage.ts` adapter that already backs `jd-captures/` and `cv-output/`, with a
signed URL as "the link"; text/URL → stored as-is as the link); if the drop yields nothing usable, it still
opens the same small inline form pre-filled with today's date so you can paste a link by hand. The gesture
works either way — auto-fill is a bonus, not a dependency. **Auto-extracting the subject/date from an
actual `.msg`/`.eml` file** (via something like `@kenjiuno/msgreader` for `.msg` or `mailparser` for `.eml`)
is a real phase-2 enhancement, not required for v1, since the inline form covers the date manually either
way.

**Confirmed: Outlook Classic, with New Outlook as a fallback if needed.** That's the good case — classic
desktop Outlook is exactly the client that reliably produces a real `.msg` file drop, so the auto-fill path
(upload the dropped file, store it, skip the manual date/link entry) is worth building as the primary path
rather than a stretch goal, with the manual inline form staying as the fallback for whatever New Outlook
doesn't hand over cleanly. The SharePoint link format you shared as an example of how you reference postings
today — `nunonine.sharepoint.com/sites/JobHunting/...` — is a separate, existing habit from before this
rebuild and doesn't change anything here; noting it in case it's relevant context for a later conversation,
not acting on it in this one.

One thing this explicitly does **not** do: produce a live, click-through link back into your actual mailbox
(an OWA/Graph deep link). That would need Graph API + OAuth wired into RoleProof, which doesn't exist today
and is a materially bigger addition than this feature. "The link to the confirmation email" in this design
means a link to an *archived copy* RoleProof stored itself — good enough to re-open and re-read the email
without leaving the app, but not a live mailbox link. Flag if a live link actually matters to you; it's a
separate, larger piece of work (Microsoft Graph integration), not a drag-and-drop detail.

## 2.4 The decline pop-up — "Reply with thanks" as an event, not a destination

Dropping a decline email onto a `response_pending` row sets `status: 'screened_out'`, records
`outcomeEmailLink` + `outcomeAt`, and moves the lead to the Archive — all of that happens immediately, no
extra click needed. Right after, a pop-up (a modal, not a route — dismissible, no back-button state to
manage) offers the reply assist inline: an editable template —

> "Thank you for letting me know, and for considering my profile. I remain very interested in
> `{company}` and would welcome being considered for future roles that fit my background."

— with **Copy text**, **Open in email** (a `mailto:` pre-filling subject/body in your default mail client),
and **Skip** buttons. RoleProof has no outbound-email capability today (no SMTP/Graph send integration) and
I wouldn't wire one up without you asking for it specifically — sending a professional reply is something
you should see and approve before it goes out, so this stays an assist, not an automation, either way. If a
`.msg`/`.eml` gets parsed in phase 2, the sender address could pre-fill the `mailto:` `To:` field too;
without that, `mailto:` just opens a compose window and you paste it into the existing thread reply.
Skipping the pop-up (or closing it) doesn't undo the status change — the lead is already in the Archive
either way; the pop-up is purely the reply assist, not a confirmation gate.

## 2.5 Archive — a reference list, not a pipeline stage

The piece that was actually missing: somewhere to see Stopped applications *as a body of past cases*, not
just individually while working the current lead. The stated use case is pattern-matching — "have I seen a
rejection like this before, for a similar company or role, and what did I submit that time" — which means
the Archive's value isn't the list alone, it's the list plus a fast path back into each lead's full detail
(screening scores, requirements, the tailored CV that was sent), so a past case is actually usable as a
reference and not just a name in a list.

**Confirmed scope: only `applications.status = 'screened_out'`** — "processed" applications that ran their
full course and stopped. `roadblocked` / `misaligned` triage drops from Part 1 explicitly stay out of the
Archive; they never had an application to stop, and Archive is a body of finished cases, not everything
that's terminal. That data isn't wasted, though — it's earmarked for a separate future feature: (a)
throughput stats (leads processed vs. leads actually sent — a funnel number the current dashboard funnel
doesn't compute today) and (b) pattern-mining which roadblocks/misalignments recur most, to feed back into
*where you look for leads in the first place* — which is exactly the kind of observation the CI notes
already capture by hand (`Process/CI/Introduce Environment Gate Check during Screening Phase.md` is a
real example: two declines in a row traced to the same missing environment). Worth a CI note of its own
once this ships, rather than building the stats view speculatively now.

V1 is a plain list — company, role, stopped date, a link into the lead. Filtering/search by company, JD
group, or requirement overlap (the part that would make "find a similar past case" actually fast rather
than just scrollable) is a real v2 candidate, not required to ship the reference view itself.

## 2.6 Retiring the existing Returns panel

`components/roleproof/returns-panel.tsx` is a small card on `/dashboard`, gated by `env.nextReturns`, that
already does a lighter version of this — same `applications` row, same status values, button clicks
instead of drag-and-drop, no date/link capture beyond `appliedAt`. You said you don't actually know what
the Returns panel is — which settles this: a feature living on the dashboard that its own owner doesn't
recognize isn't earning its spot, so **retire it** rather than maintain two UIs over one dataset. Its one
genuinely good idea — flagging an application with "no word yet" after 7+ days so nothing goes stale
silently — is worth keeping, just folded into the Applications list itself (a `stale` badge on
`response_pending` rows past that threshold) rather than kept alive as a second destination. The underlying
`recordOutcomeAction` writes (`recordActivity`/`recordUxEvent`) stay — the new tab's actions
(`logDeclineAction`, `logInterviewScheduledAction`, etc.) call the same ones, so the Statement feed doesn't
lose the signal, only the standalone panel goes away.

## 2.7 Files touched (checklist — Part 2)

| File | Change |
| --- | --- |
| `lib/db/schema.ts` | 5 new nullable columns on `applications` (§2.2, now including `interviewAt`) — plain columns, no enum, no migration risk beyond a normal `ALTER TABLE ADD COLUMN` |
| `app/actions/monitoring.ts` | Extend `ALLOWED_OUTCOMES` with `response_pending`; new actions: `logApplicationSentAction` (drop-or-manual), `logDeclineAction` (sets `screened_out`, no popup logic here — that's client-side), `logInterviewScheduledAction` (takes the manual `interviewAt` too) — all update `applications` + call `recordActivity`/`recordUxEvent` like `recordOutcomeAction` does today |
| `lib/storage.ts` | Reused as-is for storing dropped `.msg`/`.eml` files under `applications/{leadId}/` |
| `components/roleproof/applications-list.tsx` (new) | The unified list (§2.3) — response-pending and interview-scheduled rows, conditional columns, `stale` badge folded in from the retired Returns panel (§2.6) |
| `components/roleproof/decline-popup.tsx` (new) | The modal fired at decline-drop time (§2.4) — reply template, Copy/Open-in-email/Skip |
| `components/roleproof/archive-list.tsx` (new) | The Stopped-applications reference list (§2.5), linking into each lead's detail page |
| `components/roleproof/results-table.tsx` (Part 1, extend) | Row action: `Tailoring CV` while tailoring, drop-target "Application sent" once `ready` |
| `components/roleproof/returns-panel.tsx` | Removed; `/dashboard` drops the import (§2.6) |
| `app/roleproof/applications/page.tsx` (new) | Route for the unified Applications list |
| `app/roleproof/archive/page.tsx` (new) | Route for the Archive reference list, outside the Flow tab group (§2.2 nav) |
| `lib/env.ts` | `nextMonitoring` flag, same additive convention as `nextScoringQueue` |

## 2.8 Open decisions for you (Part 2)

1. Is "Application sent" really the same affordance as dropping the confirmation email, or should it be a
   plain click with the email attached separately later (§2.1)?
2. Does "the link to the confirmation email" need to be a live mailbox deep-link (Graph API — a much
   bigger addition), or is a link to an archived copy stored in RoleProof itself good enough (§2.3)?

~~Resolved:~~ Archive stays scoped to `screened_out` only; `roadblocked`/`misaligned` feed a separate future
stats/CI-note feature instead, not the Archive (§2.5). `interviewAt` is a real date/time picker, not a
display field (§2.2). Dragging from Outlook Classic (§2.3) — build the auto-fill path as primary. Retire
the Returns panel outright, folding its stale-application nudge into the Applications list (§2.6). Tab
renamed **Applications** (§ nav).
