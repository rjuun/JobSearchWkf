

Implementation plan for splitting B-phase screening into an automatic B1–B3 pass at capture time and a user-triggered, batch B4–B6 scoring pass after manual triage. Grounded against the current code in `lib/pipeline/screening.ts`, `lib/db/schema.ts`, `app/actions/pipeline.ts`, `components/roleproof/kit.tsx`, `lib/ui.ts`, `lib/db/types.ts`, and `docs/ARCHITECTURE.md` / `docs/PIPELINE.md` as of 2026-07-26.

Out of scope: `lib/llm/client.ts`, `lib/prompts.ts`, model routing, and anything about which model scores a step — this is purely about lead flow through B1–B6.

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

- **`'screening'` already exists but is dead code.** It's wired into `COMPLETED`, `STAGE_PILL`, and `rpNextAction` in `components/roleproof/kit.tsx` (shows "Running…", not actionable) and into `STATUS_META` in `lib/ui.ts`, but nothing in the current pipeline ever sets a lead's status to it — `runScreening` runs straight through B1–B6 and only writes `hold` or `screened` at the very end. It was evidently built for an in-progress marker that was never wired up. This redesign finally gives it a job.
- **`docs/PIPELINE.md`'s own diagram already documents the B1 gate as blocking B2**, not just flagging after the fact: `B1 → G1{≥60 days old?} → (no) → B2`. The current code doesn't actually implement that — `runScreening` runs B2–B6 regardless and only decides `hold` vs `screened` after B6. This redesign is the point where the code catches up to what the docs already say it should do.

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

The architectural note suggested modelling this "the same way" as the C2 Keep/Maybe/Drop gate (`requirementTailoring.approvalStatus`, a dedicated enum column, default `pending`). I looked at that pattern closely and I'm recommending against copying it literally, for one structural reason: C2's gate is a **per-row** decision (one of many `requirement_tailoring` rows per lead), so it _needs_ its own column — `job_leads.status` says nothing about any individual row. The Scoring Queue triage is a **per-lead** decision, and `job_leads.status` is already the single thing every consumer in this codebase keys off: `rpNextAction`, `STAGE_PILL`, `COMPLETED` (stage pips), the board's `active` filter, the "Needs you" focus queue. Adding a second, parallel `screening_gate` column would mean every one of those call sites has to remember to check two fields instead of one, and they'd need to stay in sync. Extending `status` keeps a single source of truth and costs nothing — the _pattern_ I'm carrying over from C2 is "a persisted enum, default to an undecided state, one action sets it, only one outcome flows downstream," not the specific choice of a separate column. Flagging this as a real decision, not a rubber-stamp — say if you'd rather have the parallel-column version for some reason I'm not seeing (e.g. wanting to re-triage a dropped lead without losing the terminal status).

No new reason-code column is needed either: `roadblocked` vs `misaligned` _is_ the reason, and the detail (which roadblock, which misalignment) already lives in the existing `roadblocks` / `misalignments` jsonb columns populated by B2/B3.

### Optional: `triaged_at`

For symmetry with the provenance backbone already established on `requirement_tailoring.approvedAt` ("M7 — stamp only on transition into the terminal-ish state"), consider adding `job_leads.triaged_at: timestamp`, set once when a lead first leaves `scoring_queue`. Not required for the feature to work, but cheap, and gives you "how long did this sit in the queue" for free later. Your call.

### Ripple: every place `LeadStatus` is enumerated

Adding enum values means touching the mirrors of that union, not just the DB enum:

|File|Change|
|---|---|
|`lib/db/schema.ts`|Add the 4 values to `leadStatusEnum`|
|`lib/db/types.ts`|Add to the `LeadStatus` union|
|`lib/ui.ts`|Add to `LeadStatus` union, `STATUS_META` (label/tone/bar/stage — `scoring_queue`/`selected` → `stage: 'screen'`, `roadblocked`/`misaligned` → `stage: 'archived'`-equivalent), `STATUS_ORDER`|
|`components/roleproof/kit.tsx`|`COMPLETED` map, `STAGE_PILL` map, `rpNextAction` switch (new cases: `scoring_queue` → "Triage", `selected` → "Ready to score", `roadblocked`/`misaligned` → not actionable)|
|`app/roleproof/page.tsx`|`active` filter currently excludes only `archived` — extend to also exclude `roadblocked`/`misaligned` from the main board (they're terminal drops, same as archived), and add a "Needs you" focus entry for `scoring_queue` leads pointing at the new queue page|
|`app/dashboard/page.tsx`|Has a hardcoded stage list including `'screening'` — check whether `scoring_queue`/`selected` need an entry there too|

### Migration mechanics

The enum has never been altered since `drizzle/0000_slim_toro.sql` — every value was baked in at creation, so there's no `ADD VALUE` precedent in this repo's migration history to copy from. Two things to watch:

1. `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction as a statement that _reads_ the new value (Postgres restriction). Drizzle-kit's generated migrations already use `--> statement-breakpoint` to split statements, which handles this correctly as long as you don't hand-edit the generated SQL to combine steps.
2. **Deploy the migration before deploying the code** that writes `scoring_queue` / `selected` / `roadblocked` / `misaligned` — an enum value must exist before any `INSERT`/`UPDATE` references it.

Run `drizzle-kit generate` after editing the schema, inspect the output SQL (should be four `ALTER TYPE "public"."lead_status" ADD VALUE 'x'` statements), then `drizzle-kit migrate` (or your existing `scripts/migrate.ts`) against the DB before shipping the app code.

---

## 2. Pipeline split — `lib/pipeline/screening.ts`

Current `runScreening(leadId, ownerId?)` runs B1→B2→B3→B4→B5→B6 as one function. Split it into two exported functions plus keep the original as a thin wrapper so nothing that already calls `runScreening` directly (scripts, tests, a manual "run everything" fallback) breaks:

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

The B1–B6 bodies themselves (LLM calls, Zod validation, scoring math, `recordRun`) don't change — this is a control-flow split, not a rewrite of any step's logic. Re-verify the exact hold-check placement against the code at build time; today's `shouldHold` is computed twice (once in the B1 block for band display, once again at B6 for the final status write) — the initial-checks version should compute it once and act on it immediately rather than deferring the decision to B6.

### `app/actions/pipeline.ts`

Add `runInitialChecksAction(leadId)` and `runScoringAction(leadId)` alongside the existing `runScreeningAction`, following the same shape (owner-scoped fetch, JD-length guard, `recordActivity`, `revalidatePath`). `runScoringAction` is the one the batch UI calls once per selected lead.

---

## 3. Capture-time hook — firing B1–B3 automatically

`lib/pipeline/capture.ts`'s `createLead()` already does one inline LLM call (A1 extraction) synchronously, wrapped in try/catch so a failure never loses the captured lead — that's the precedent to follow, not a new pattern. Add the call to `runInitialChecks(row.id, ownerId)` at the end of `createLead()`, same style: awaited, best-effort, swallowed on error (a failed auto-run just leaves the lead at `captured`, and the existing board affordance — `rpNextAction('captured') → "Screen"` — becomes the manual fallback, unchanged).

**Real risk to check before building this, not to assume away:** `/api/ingest` and `createLeadAction` would now make up to 4 sequential LLM calls in one request (A1 + B1-code + B2 + B3) instead of 1. I didn't find a `maxDuration` export or `vercel.json` anywhere in the repo, meaning both routes currently run on whatever Vercel's plan default is — 10s on Hobby, higher on Pro/Enterprise. Three extraction-tier Sonnet calls are usually a few seconds each, so this is a real chance of tripping a default Hobby timeout even though it's a single lead, not a batch. Two mitigations, pick one after checking the actual plan/config:

- **Preferred if the plan allows it:** add `export const maxDuration = 30;` (or whatever headroom you want) to `app/api/ingest/route.ts` and the `createLeadAction` server action's route. Simplest, no architecture change, and single-lead calls are exactly the case Vercel's duration limit is _not_ the documented risk for (that risk is specifically the batch B6 case in `docs/ARCHITECTURE.md`'s risk table).
- **If stuck on a hard 10s ceiling:** return the lead id from `/api/ingest` immediately after the insert (before A1 even runs), and have the client (capture page / bookmarklet) fire a second request to a new tiny endpoint that runs A1 + `runInitialChecks` after the redirect. More moving parts for a problem you may not actually have — check the Vercel plan/config first.

This is unrelated to the batch-scoring duration risk the architecture doc already covers — that one's about looping over _many_ leads in one function; this is one lead, up to 4 calls, and the existing A1 call already sets the "average duration is fine, verify the ceiling" precedent.

---

## 4. Scoring Queue UI

New route: `app/roleproof/scoring-queue/page.tsx`, linked from the board (`app/roleproof/page.tsx`) both as a nav entry and as a "Needs you" focus card once ≥1 lead sits at `scoring_queue`. Naming note: the codebase already has an R5 feature called **"Weekly Triage"** (`components/roleproof/weekly-triage.tsx`, `app/actions/triage.ts`) which is unrelated — it's a capacity-based ranking of leads already past scoring, for deciding what to tailor this week. Calling the new B2/B3 gate "triage" too, in code or UI copy, will collide with that existing vocabulary. Recommend: keep "triage" as the _verb_ for the interaction (matches your own framing above) but name the route/components around **"Scoring Queue"** specifically (`ScoringQueueList`, `ScoringQueueTriageCard`, `setScreeningGateAction`) so grep and code review don't conflate the two features.

**List view** (`ScoringQueueList`) — leads with `status IN ('scoring_queue', 'hold')`, each row showing title/company/city, a "clean" badge or roadblock/misalignment count chips (reusing the existing `roadblocks`/`misalignments` chip rendering already in `components/roleproof/workspace.tsx`'s "Watch-out" section rather than inventing new chip styling), and a checkbox for the eventual batch trigger. Include `hold` leads here too (flagged, not blocking) rather than hiding them in a separate bucket, since B1–B3 already ran for them if you use "screen anyway" — they're informational, not a 4th triage outcome.

**Triage interaction** (`ScoringQueueTriageCard`) — one lead at a time (or all as a stack/queue — your call), full roadblock/misalignment detail, three buttons: Roadblocked / Misaligned / Selected. Wire to `setScreeningGateAction(leadId, 'roadblocked' | 'misaligned' | 'selected')` in a new `app/actions/scoring-queue.ts`, mirroring `setApprovalAction`'s shape in `app/actions/tailoring.ts` (owner-scoped update, `revalidatePath`, no `recordActivation`/`recordActivity` needed unless you want the Statement feed to mention it).

**Batch scoring trigger** — once ≥1 lead is `selected`, a "Run scoring · N leads" button. Client-side handler loops sequentially over the selected ids, calling `runScoringAction(id)` per the ARCHITECTURE.md mitigation (N calls to the existing per-lead action from the client, not a new server-side loop), updating a small per-lead status indicator (queued → running → done) exactly the way `workspace.tsx`'s existing `onScreen()`/`onMap()` handlers already drive their own busy-step UI — same pattern, just looped:

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

Sequential (not `Promise.all`) is deliberate here, not just a duration-safety habit — it's also what gives you the tighter, more predictable timing between calls that the caching note above is counting on for a better cache-hit rate on B4–B6's system prompts than today's one-lead-at-a-time-across-hours pattern produces. Parallel would remove that benefit for no real speed win, since each call still has to complete regardless of order.

**Results / ranking view** — once the batch finishes, leads that were `selected` and are now `screened` (or `hold`, if B1 re-flagged one mid-batch) get shown ranked by `overallFitScore` descending, reusing the existing `RpScore` / `RpVerdictPill` components from `kit.tsx` rather than new score styling. This can be the same list view filtered/sorted differently, or a dedicated summary — see the mockups above for the shape I'd suggest (rank, lead, score, tier, next action), matching the board's existing Proceed (≥7)/Borderline(≥5.5)/Hold thresholds so the color language stays consistent app-wide.

---

## 5. Feature flag

Every additive surface in this app ships behind a `lib/env.ts` flag (`nextThisWeek`, `nextTriage`, `nextSourcingCompass`, etc.) — on by default, instantly retireable with `NEXT_*=0`. Add `nextScoringQueue: str('NEXT_SCORING_QUEUE', '1') !== '0'` and gate the new route/board entries behind it, consistent with how `env.nextTriage` currently gates the Weekly Triage strip.

---

## 6. Files touched (checklist)

|File|Change|
|---|---|
|`lib/db/schema.ts`|4 new `lead_status` enum values; optional `triaged_at` column|
|`drizzle/00XX_*.sql` (generated)|`ALTER TYPE` migration|
|`lib/db/types.ts`|`LeadStatus` union|
|`lib/ui.ts`|`LeadStatus` union, `STATUS_META`, `STATUS_ORDER`|
|`lib/env.ts`|`nextScoringQueue` flag|
|`lib/pipeline/screening.ts`|Split into `runInitialChecks` / `runScoring`, keep `runScreening` wrapper|
|`lib/pipeline/capture.ts`|Fire `runInitialChecks` at end of `createLead()`, try/catch|
|`app/api/ingest/route.ts`|Possibly `export const maxDuration`|
|`app/actions/pipeline.ts`|`runInitialChecksAction`, `runScoringAction`|
|`app/actions/scoring-queue.ts` (new)|`setScreeningGateAction`|
|`components/roleproof/kit.tsx`|`COMPLETED`, `STAGE_PILL`, `rpNextAction` — new status cases|
|`components/roleproof/scoring-queue.tsx` (new)|List + triage card + batch runner (client)|
|`app/roleproof/scoring-queue/page.tsx` (new)|Route|
|`app/roleproof/page.tsx`|`active` filter, "Needs you" entry, nav link|
|`app/dashboard/page.tsx`|`STAGE_ORDER` (line ~51) and the `FUNNEL` array (line ~43) are hand-maintained status lists — `FUNNEL`'s "Screened" bucket currently sums `screened + hold`; `scoring_queue`/`selected` leads would silently vanish from the funnel and undercount "in play" (`totalLeads - archived - applied`) unless added|

---

## 7. Open decisions for you

1. **Status-column vs. separate gate column** (Section 1) — I recommended extending `status`; flag if you want the parallel-column version instead.
2. **Vercel `maxDuration` on the ingest path** — needs checking against your actual plan before assuming inline B1–B3 is safe; I gave two mitigations.
3. **Whether `hold` leads should be visible inside the Scoring Queue list** (flagged, not blocking) or kept in a fully separate bucket the way they are today — I defaulted to "visible, flagged."
4. **Naming collision with the existing "Weekly Triage" (R5) feature** — recommended keeping "Scoring Queue" as the noun in code/routes even though "triage" stays the verb in your own framing.


---
![[Pasted image 20260727230812.png]]


![[Pasted image 20260727230842.png]]



![[Pasted image 20260727230905.png]]


![[Pasted image 20260727230940.png]]




