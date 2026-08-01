---
ci-area: LLM tool schemas / pipeline reliability
ci-title: Complete `required` lists on the remaining strict tool schemas
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-01
ci-estimated-time: 6
ci-time-spent: 0
pr-source: "[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
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
  fit score was computed without requirements. **Sequencing matters: do not re-run until this CI is done**,
  or 157 leads get re-screened through still-degraded B3–B6 and have to be run again.
- **Retiring `job_requirements.requirement_group`.** It receives a duplicate of `rank` and is read by
  nothing. Data-shape decision on its own terms.
- **Connector-era references in the `Process/*.md` notes** (OneDrive / SharePoint / `.xlsx` as data
  sources). Documented in the parent CI §3.3.

### 2.1 The exact defects — verified by static audit 2026-08-01

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

- [ ] Static audit re-run and clean — no strict schema has properties missing from `required`
- [ ] Each of the ten schemas measured before/after per §2.3, results recorded in §4
- [ ] Each step's `Process/*.md` note checked for a field the schema cannot express (the B2 `groupRank`
      class of defect); any addition justified in §4
- [ ] `npm run typecheck` clean
- [ ] `npx vitest run` — all passing (155 at the time of writing)
- [ ] Mock mode still works (`LLM_MODE` unset → `mock` fixtures satisfy the widened schemas)
- [ ] One live end-to-end screening run, and one live tailoring run, verified in the UI

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
