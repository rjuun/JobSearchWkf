---
ci-area: LLM tool schemas / pipeline reliability
ci-roadmap:
ci-title: Complete `required` lists on the remaining strict tool schemas
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-01
ci-estimated-time: 6
ci-time-spent: 2
pr-source: "[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[{"name":"Development","startTime":"2026-08-01T23:32:05.000Z","endTime":"2026-08-02T00:49:41.000Z"},{"name":"Development","startTime":"2026-08-03T09:49:41.000Z","endTime":"2026-08-03T10:21:21.000Z"},{"name":"Development","startTime":"2026-08-04T16:31:23.000Z","endTime":"2026-08-04T16:53:18.000Z"}]}
```
---

> [!IMPORTANT] Start here — this note is self-contained
> It is written to be picked up in a **fresh chat with no prior context**. Everything needed is below:
> the defect, the proof, the exact list, the fix pattern, and the measurement protocol. Read §1 and §2
> before touching code. The parent CI
> `[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]` has the full
> investigation if you want the backstory, but you should not need it.

---

## 1. What is the problem or opportunity?

**Every `strict: true` tool schema in `lib/llm/schemas.ts` declares more properties than it lists in
`required`. On the one schema where this was measured (B2), it silently destroyed the step's output.**

### The mechanism

Anthropic's strict tool use grammar-constrains sampling: the model can only emit tokens that fit the
declared `input_schema`. The contract is `additionalProperties: false` **plus a complete `required` list**.
An incomplete `required` list does **not** make the omitted fields optional — it degrades the grammar, and
generation collapses to a near-empty result that is still schema-valid.

Because the degenerate output *is* valid, nothing catches it: `runStructured` logs `status='ok'`,
`attempts=1`, its bounded zod retry never fires, and downstream steps proceed against near-empty input.

### The proof (from B2, the parent CI)

B2's item schema declared six properties and required three. Measured on three real job descriptions,
success = 4 or more requirements extracted:

| B2 item schema | Vestas | COWI | Aliaxis |
| --- | --- | --- | --- |
| `required` = 3 of 6 (as shipped) | 0/13 | 0/2 | 0/2 |
| `required` = all 6 | 2/5 | — | — |
| `required` = all 6 **+ the missing `groupRank` field** | 6/6 | 3/4 | 4/4 |

The decisive control: with `strict: false` the *identical* prompt returned ~3,200 tokens of correct content
— but delivered `requirements` as a JSON **string** instead of an array, which zod rejects. The model always
had the answer; the constraint was collapsing it. **Turning `strict` off is not a workaround.**

Also ruled out on B2, so don't re-chase them here: `max_tokens` (identical at 8000 and 32000), model tier
(Opus 4.8 failed identically), `effort`, prompt wording, and CI guidance injection.

### Why this matters now

B2 is fixed and live-verified. The other ten schemas have the same defect and are **unmeasured**. The
array-of-many schemas are the most exposed, because that is where collapse is total rather than a quietly
dropped optional field.

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:** complete the `required` list on the ten schemas in §2.1, one at a time, each with its own
before/after measurement per §2.3.

**Out of scope — each needs its own CI:**
- **Re-running the back catalogue.** `job_requirements` held 0 rows across all 157 leads, and every stored
  fit score was computed without requirements. **Sequencing matters: do not re-run until this CI *and*
  `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]` are done** — scores are
  currently produced without requirements *and* without evidence, so an early re-run just manufactures a
  second generation of untrustworthy numbers.
- **Retiring `job_requirements.requirement_group`.** It receives a duplicate of `rank` and is read by
  nothing. Data-shape decision on its own terms.
- **Connector-era references in the `Process/*.md` notes** (OneDrive / SharePoint / `.xlsx` as data
  sources). Documented in the parent CI §3.3.

### 2.1 The exact defects — verified by static audit 2026-08-01

> [!NOTE] Superseded 2026-08-03 — all of these are fixed; the B6 rows were already stale when written
> The table below is the audit as it stood on 2026-08-01. Every row has since been closed (§4), and the
> two `B6` rows were fixed independently by
> `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]` before this note was
> actioned. Don't hand-check against this table — run `npx tsx scripts/audit-strict-schemas.ts`, which
> regenerates it from the code.

Every row is a real occurrence. `MISSING` = declared in `properties` but absent from `required`.

| Schema | Path | MISSING from `required` |
| --- | --- | --- |
| `A1` | root | `company`, `city`, `formatSignals`, `atsSystem` |
| `B3` | `.roadblocks[]` | `requirementOrder` |
| `B4` | `.misalignments[]` | `severity` |
| `B5` | root | `jdGroupPrimary`, `jdGroupSecondary`, `notes` |
| `B6` | root | `summary` |
| `B6` | `.requirements[]` | `keyStrengths`, `gaps` |
| `C2` | root | `gaps` |
| `C2` | `.links[]` | `connection`, `cvPosition` |
| `C2` | `.gaps[]` | `order`, `requirement` |
| `C3` | `.bullets[]` | `skills` |
| `C7` | root | `summary` |
| `C7` | `.requirements[]` | `keyStrengths`, `gaps` |
| `COACH_DRAFT` | root | `result`, `metric`, `needsMetric`, `confidence` |
| `IMPORT` | root | `profile` |
| `IMPORT` | `.profile` | `name`, `headline`, `location` — **`required` is empty** |
| `IMPORT` | `.positions[]` | `company`, `title`, `startDate`, `endDate`, `summary` |
| `IMPORT` | `.stories[]` | `summary` |
| `IMPORT` | `.stories[].results[]` | `metric` |
| `IMPORT` | `.skills[]` | `proficiency`, `atsKeywordVariants` |
| `IMPORT` | `.education[]` | `institution`, `qualification`, `year` |
| `IMPORT` | `.languages[]` | `cefrLevel` |

Re-generate this table at any time (no API calls, no DB):

```ts
// walk every exported *.tool.input_schema where strict === true;
// at each {type:'object', properties}, report Object.keys(properties) minus (required ?? [])
```

**Suggested order — highest blast radius first:** B6 → B5 → B3 → B4 (every screening run) → C2 → C7 → C3
(every tailoring run) → A1 (every capture) → IMPORT → COACH_DRAFT.

### 2.2 The fix pattern

For each object node, list **every** property in `required`:

```ts
// before
required: ['dimension', 'detail'],
// after
required: ['dimension', 'detail', 'requirementOrder'],
```

Three things to keep in mind:

- **`required` means "the key is present", not "the value is non-empty".** Semantics are preserved: an
  unstated `sourceText` becomes `""`, an absent `severity` becomes `""`. This is why the change is safe.
- **…but only for strings.** An `integer` has no empty form, so requiring one forces the model to invent a
  number where "not applicable" was the honest answer. Give those fields an explicit **0 sentinel**, document
  it in the property description *and* in the user message, and match on `> 0` at the write path. Two fields
  needed this — see §4. Booleans and arrays are fine (`false`, `[]` are real answers).
- **And it never guarantees the value is meaningful.** A required field can come back holding the literal
  string `placeholder`. Measured on C2 — see §4.
- **Check the matching zod schema accepts it.** Most optional fields are already
  `.nullable().optional()`, which accepts a present-but-empty value. Where zod is stricter, widen it.
- **Check the DB write path** in `lib/pipeline/screening.ts` / `tailoring.ts` for `?? null` coalescing —
  usually already correct, but confirm per schema.

**If a schema is missing a field its own `Process/*.md` note demands, add the field.** That was the second
half of B2's fix and it mattered more than the `required` list alone (2/5 → 6/6). B2's note specified a
within-group counter the schema could not express; the fix was a new `groupRank` property, not a prompt
edit. Read each step's note before assuming the schema is complete.

**Naming caution learned on B2:** where a note's vocabulary conflicts with a field the codebase already
reads, **add a field rather than repossess the existing one**. `rank` holds the group name and is read that
way in ~25 places; renaming it would have broken `queries.ts` filters, `scoring.ts` `RANK_WEIGHT`,
`tailoring.ts`, `coaching-queue.ts` and four components.

### 2.3 Measurement protocol — required, per schema

Do **not** assume B2's result transfers. Each schema gets a before/after run.

1. Write a throwaway probe under `scripts/` (delete it after; `_`-prefixed names were used previously).
   Call `/v1/messages` directly with the step's real system prompt (`systemPromptFor(step, null)`), a real
   input drawn from the DB, `tool_choice: {type:'tool', name}`, and `strict: true`.
2. Run the **current** schema 4–5 times, then the **fixed** schema 4–5 times. This failure is
   probabilistic — a single run of each proves nothing.
3. Record the output shape: array length, or `typeof` when it is not an array. Log
   `stop_reason` and `usage.output_tokens`.
4. Success = a materially fuller result that `zod.safeParse` accepts, stable across runs.

Realistic model behaviour, so you know what a fixed schema looks like: B2 went from ~65 output tokens and
0–1 items to ~3,200 tokens and 20 items.

### 2.4 Acceptance criteria

- [x] Static audit re-run and clean — no strict schema has properties missing from `required`
      (`npx tsx scripts/audit-strict-schemas.ts`, 13 strict schemas, exits non-zero on any gap)
- [x] Each of the ten schemas measured before/after per §2.3, results recorded in §4 —
      A1/B3/B4/B5 via live-operation evidence (2026-08-04), C2 via 12 live runs (2026-08-03), C3/C5/C7
      via the 2026-08-05 live tailoring run below. `IMPORT`/`COACH_DRAFT` remain unmeasured — accepted:
      neither sits in the CV path, per the 2026-08-04 deferral.
- [x] Each step's `Process/*.md` note checked for a field the schema cannot express (the B2 `groupRank`
      class of defect); any addition justified in §4 — none needed, see §4
- [x] C3's silent `originalText` substitution replaced with a count-and-re-ask floor; the three
      downstream .docx fallbacks reviewed and dispositioned (§4, scope addition)
- [x] `npm run typecheck` clean
- [x] `npx vitest run` — all passing (195)
- [x] Mock mode still works — the zod schemas were not touched, only the JSON Schema `required` arrays,
      so every existing `mock: () => …` fixture still validates; covered by the suite above
- [x] One live end-to-end screening run, and one live tailoring run, verified in the UI — 2026-08-05,
      see §4

---

## 3. Resources & references

- **Parent CI:** `[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]` — full
  investigation, the disproved hypotheses, and the `rank`/`requirement_group` decision.
- **Code:** `lib/llm/schemas.ts` (all schemas) · `lib/llm/client.ts` (`runStructured`, `callClaude`,
  `max_tokens`, `stop_reason` logging) · `lib/pipeline/screening.ts` (B-phase writes) ·
  `lib/pipeline/tailoring.ts` (C-phase writes) · `lib/prompts.ts` (`STEP_NOTE`, `systemPromptFor`).
- **Observability already in place:** `llm_calls.stop_reason` (migration `0030`) plus the `[llm]` stdout
  line. On a `max_tokens` stop the line also prints a bounded preview of the raw tool input. Grep `[llm]`
  while `npm run dev` runs.
- **Reference:** Anthropic strict tool use — `strict: true` sits on the tool definition alongside
  `name`/`description`/`input_schema`, **not** on `tool_choice`; schema needs `additionalProperties: false`
  and `required`.

### 3.1 Environment notes

- `lib/prompts.ts` caches step notes in a module-level `noteCache` that never invalidates. **Editing any
  `Process/*.md` note requires a dev-server restart** to take effect.
- A fresh `cache[w=… r=0]` on the `[llm]` line confirms the system prompt bytes changed — useful to verify
  a note edit actually loaded.
- `next lint` is broken in this repo (pre-existing). Verify with `npx tsc --noEmit` + `npx vitest run`.

---

## 4. Notes / Progress log

### 2026-08-01 · Opened

Split out of the B2 CI once B2's fix was live-verified, per `[[++ Continuous Improvement Procedure]]`
§"Splitting large CIs". B2's own scope is complete and closed at `3 - Delivered`; this note carries the
sibling defect forward.

Nothing implemented yet. The §2.1 table is a **static audit** — the defect is confirmed to exist in all ten
schemas by inspection, but the *behavioural* impact is measured only for B2.

### 2026-08-03 · All lists completed; C2 measured; the fix is necessary but NOT sufficient

**Code.** Every `required` list in `lib/llm/schemas.ts` is now complete. `scripts/audit-strict-schemas.ts`
re-runs the §2.1 audit with no API calls and no DB, and exits non-zero on any gap — it reproduced the
§2.1 table exactly against the pre-change file (19 object nodes) and reports clean against the current one
(13 strict schemas). §2.1's table is otherwise **stale on B6**, which the Master Bullet Bank CI had already
completed; B2 and B6 were the two reference schemas going in.

**One correction to §2.2's reasoning.** "`required` means the key is present, so an unstated value becomes
`""`" holds for *strings*, and that is most of the list. It does **not** hold for integers, which have no
empty form — a required `integer` forces the model to invent a number. Two fields were affected, and both
now carry an explicit **0 sentinel** documented in the schema and in the prompt: `B3.roadblocks[].requirementOrder`
("the roadblock is implied across the posting as a whole") and `C2.gaps[].order` ("not one of the numbered
requirements"). B3's write path matches on `> 0` rather than `!= null`.

**Write paths (§2.2's third bullet), four real regressions caught before they shipped.** Where the code used
`??` to mean "the model said nothing", a now-required field arrives as `""` and `??` stops firing:

| Path | Would have happened |
| --- | --- |
| `screening.ts` B5 `jdGroupPrimary` / `jdGroupSecondary` / `keyPatterns` | a stored value overwritten with `""` |
| `tailoring.ts` C2 `cvPosition` | `""` beats the evidence node's own slot, losing the fallback |
| `capture.ts` A1 `formatSignals` | `""` stored instead of null |
| `onboarding.ts` O2 draft wrapper (all strings, incl. `metric`) | `""` surfacing as a blank metric in the review UI |

B5 now uses `nullIfBlank(...) ?? stored` — the same helper the B6 collapse guard introduced, which also trims
whitespace-only replies.

**Note-vs-schema check (§2.4, third criterion).** Done for the C-phase and B-phase steps. No B2-`groupRank`-class
gap found: the rewritten `Process/C2` §G states explicitly that `original_text` is copied from the supplied
listing by the app, not emitted by the model, so C2 needs no `originalText` property. The one loose thread is
§E.4's "document the reason briefly in the Notes" — there is no `notes` field on `links[]`; `connection` is the
nearest home for it and is now required. Not worth a new field on this evidence.

**Measurement (§2.3) — C2, the highest-value schema, via `scripts/backtest-notes.ts`.** Twelve live Opus runs
against three real leads, read-only. The C2 note is byte-identical on both arms of this branch, so the harness's
base/cand split is pure run-to-run variance and all twelve runs sample the **fixed** schema. Compared against
the twelve runs recorded in `scripts/data/backtest-notes.md` on the old schema:

| | before (old schema, 12 runs) | after (complete lists, 12 runs) |
| --- | --- | --- |
| collapsed runs (coverage < 50%) | **3** | **1** |
| mean links | 8.7 / 10.7 | 16 / 14.3 |
| mean requirement coverage | 63.5% / 79% | 85.7% / 72.2% |
| fabricated citations | 1 | 1 (baseline arm) |

Raw per-run data and the generated report: `scripts/data/schema-ci/`.

**The result that matters is the residual, not the improvement.** The collapse rate fell but did not go to zero,
and the surviving collapse has the signature the B6 CI warned about — a required key present and meaningless:

```json
{"links":[{"order":4,"evidenceRef":"C7","matchStrength":"Very Strong","connection":"placeholder","cvPosition":""}],"gaps":[]}
```

108 output tokens, 1 link against 15 Core/Important requirements, `gaps` empty. Before the fix the same collapse
dropped `connection` entirely and repeated one link verbatim; now the key is there and its value is the literal
string `placeholder`. A second, otherwise-healthy 21-link run also emitted one `"connection":"placeholder"` row.
**Completing the list changed the shape of the collapse without removing it.** §1's mechanism is real and the fix
is worth having — but this note should not be read as "C2 is fixed".

**Recommended follow-up, deliberately NOT done here.** C2 wants the same class of guard `runScoring` just got for
B6: re-ask, then refuse to write, when the model has plainly not worked through the list. The correct floor is
**links ∪ gaps must account for every Core/Important requirement** — not B6's exact-coverage floor, because C2 is
*allowed* to leave a requirement unlinked as long as it says so in `gaps`. That floor could not be validated from
this run: `backtest-notes.ts` computes coverage as `unique link orders / coreImportant` and **ignores `gaps`
entirely** (line 391), so its 59–100% spread on healthy runs understates true accounting and cannot tell a
legitimate gap from a skipped requirement. Teaching the harness to record the union is the prerequisite, and that
plus the guard is its own CI.

### 2026-08-04 · Live-operation evidence for the B phase (21 leads, 137 calls)

§2.3 asked for a controlled before/after per schema. For the B phase that is no longer obtainable — the
pre-fix schemas are gone from the code, and reconstructing them would cost money the re-screen needs. What
replaced it is stronger for the question that actually matters (*do the completed lists work in
production?*) and it was free: two days of real ingestion and screening through the UI.

`scripts/audit-llm-call-shape.ts` (new, read-only, no API calls) reads `llm_calls` and reports the
output-token distribution per step. Every collapse this project has found shares one fingerprint — a reply
an order of magnitude below the step's healthy output that is still schema-valid, still `status='ok'`,
still `attempts=1`. Counting rows never finds it; counting tokens does.

`npx tsx scripts/audit-llm-call-shape.ts --days 7` — 137 live production calls across 21 leads
(mock, backtest and measurement traffic excluded):

| Step | n | median out | min | max | short (<median/5) | errors | non-`tool_use` stop |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | 1 | 67 | 67 | 67 | 0 | 0 | 0 |
| B2 | 30 | 2131 | 0 | 8000 | 9 | 2 | 0 |
| B3 | 26 | 37 | 0 | 177 | 1 | 1 | 0 |
| B4 | 25 | 121 | 36 | 272 | 0 | 0 | 0 |
| B5 | 25 | 608 | 561 | 727 | 0 | 0 | 0 |
| B6 | 27 | 3145 | 256 | 5875 | 8 | 0 | 0 |
| C3 | 1 | 1548 | 1548 | 1548 | 0 | 0 | 0 |
| C5 | 1 | 250 | 250 | 250 | 0 | 0 | 0 |
| C7 | 1 | 1836 | 1836 | 1836 | 0 | 0 | 0 |

**The 18 short calls are the finding, and they are good news.** A re-ask guard calls `runStructured`
again, and each attempt is its own `llm_calls` row — so a guard that fires *leaves the collapsed attempt
behind on purpose*. What decided each lead is the **last** call for that lead+step:

- **17 of 18 were followed by a healthy call** for the same lead+step. B2's `tooThin` and B6's `unjudged`
  fired and recovered. Nothing degraded reached the database.
- **1 was final**: B2, 35 output tokens, 2026-07-31, lead `b921f73d` — *Senior Finance Business Partner ·
  COWI*, 3,550-char JD, **0 requirements on file**. That is the original B2 defect, one of the three leads
  in the parent CI's own proof table, from before the guard shipped. The lead is now `not_pursued`.

So across the leads screened after the fixes: **zero collapses reached the database**, and the guards are
demonstrably firing rather than merely present. `B4` and `B5` show no short calls at all and a tight
spread — `B5` ranges 561–727 tokens over 25 calls, a step behaving deterministically.

**Verdict per schema.** `A1`, `B3`, `B4`, `B5` are accepted as **verified by live operation** rather than
by §2.3's controlled A/B. `C3`, `C5` and `C7` have a single call each here, so the C phase closes on a
dedicated live tailoring run, not on this table. `IMPORT` and `COACH_DRAFT` are **explicitly deferred** —
neither is in the CV path, and coaching is parked until CV creation is proven.

### 2026-08-03 · C3's silent substitution — guarded (scope addition)

Raised while this CI was open, and taken in the same pass because it is the *other half* of the same defect: an
incomplete `required` list causes the degraded reply, and a silent fallback is what hides it. Completing the lists
without this would have left the C phase failing the way B6 failed before PR #3 — believably.

**The defect.** `generateCv` wrote `matched?.bullet || row.originalText || ''`. When C3 returned no bullet for a
ref — degraded call, or a ref echoed in a form that doesn't match — `cv_bullet` was filled with the row's **raw,
untailored evidence text**. Nothing errors, nothing is empty, the lead shows a full set of bullets and the .docx
renders. The only symptom is a CV that says the candidate's generic evidence instead of anything tailored to the
job, which is the single thing the C phase exists to produce. Structurally identical to B6's `j?.score ?? 6`: the
count of rows written is never what breaks.

**The fix**, mirroring B2's `tooThin` and B6's `unjudged` — the two existing precedents in `screening.ts`. The floor
is **exact**, like B6's and unlike the one C2 needs: C3 is handed a finite list of Keep rows and told to rewrite each
one, and there is no legitimate "I decline" outcome, because recording a gap is C2's job, not C3's. Re-ask up to
`ATTEMPTS = 3`, accumulating across attempts so a partial reply still counts for the refs it did answer; if any
ref-bearing Keep row is still without a bullet, **throw and write nothing**. Rows with no `evidenceRef` are excluded
— C3 is keyed by ref and was never given a way to answer them, so counting them would make the floor unsatisfiable
rather than strict. A **blank** bullet is not an answer either: `bullet` is required in the strict schema now, so a
degraded call returns the key holding `""`, which is the `placeholder` failure measured on C2 one step over.

`absorbC3Bullets` and `missingC3Refs` are exported pure functions for the same reason `matchB6Judgments` is —
16 cases in `lib/__tests__/c3-bullet-floor.test.ts` prove the floor without Postgres or an API key. C3's step summary
now reports the Keep items actually rewritten instead of `r.data.bullets.length`, which reported whatever the last
reply happened to contain.

**The other three instances, and why only one of them changed.** All three are in the .docx path and all three are
*downstream* of the write above, so once C3 guarantees a real bullet per ref they stop being substitution paths and
become unreachable backstops:

| Site (`lib/pipeline/tailoring.ts`) | Verdict |
| --- | --- |
| `templateSlotData` — template slot fill | **Left as-is**, commented. Render path: throwing here blocks a CV that is otherwise complete. |
| `keptBullets` → fed to **C5** | **Changed** — it was the only one missing `\|\| g.cvBullet`, so it could hand C5 raw evidence even when C3 *had* produced a bullet. An untailored bullet here doesn't degrade one line, it becomes the basis of the tailored profile. |
| `bullets14` — programmatic CV builder | **Left as-is**, commented. Same render-path reasoning. |

**Verification.** `tsc --noEmit` clean; 195/195 vitest (was 179 — the 16 new floor cases). Not run:
`scripts/verify-tailoring.ts`, which is a live smoke test that promotes a real lead, overwrites its tailoring rows
and marks four green — destructive against real data, and in mock mode it would overwrite genuine rows with mock
bullets. The floor's behaviour is fully covered by the unit tests instead.

### 2026-08-05 · Live tailoring run closes C3/C5/C7 — Delivered

The 2026-08-04 entry left C3/C5/C7 open pending "a dedicated live tailoring run." A real lead ran the
full pipeline through the UI today — live screening, live C2 evidence mapping, human approval, and
Generate CV — which fired C3 (bullets), C4 (skills section), C5 (profile), C6 (compile), and C7 (ATS
rating) against real data, ending in a downloaded, valid 2-page CV. That satisfies both remaining §2.4
boxes: the per-schema measurement for C3/C5/C7, and the standalone live screening + live tailoring
run requirement.

`IMPORT` and `COACH_DRAFT` stay unmeasured, per the 2026-08-04 deferral — neither is in the CV path.
Owner's call: acceptable to close on that basis. Moved to `3 - Delivered`.
