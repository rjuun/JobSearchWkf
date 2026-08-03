---
ci-title: Repoint the Process notes from workbooks and SharePoint to the app
ci-area: Process notes / prompt hygiene
ci-roadmap:
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-01
ci-estimated-time: 5
ci-time-spent: 3
pr-source:
pr-target:
---

---
```simple-time-tracker
{"entries":[{"name":"Development","startTime":"2026-08-01T20:18:55.000Z","endTime":"2026-08-01T22:35:01.000Z"},{"name":"Development","startTime":"2026-08-02T10:48:04.000Z","endTime":"2026-08-02T11:30:43.849Z"}]}
```
---

> [!IMPORTANT] Self-contained
> Written to be picked up in a fresh chat. §1 is the problem, §2.2 is the canonical name mapping, §2.3 is
> the decision on Output sections.
>
> **§2.2 has been re-verified against current `main` (2026-08-01) and corrected — it is now safe to
> use.** Three rows were wrong; see §4's "step 0" entry for what changed and why.

---

## 1. What is the problem or opportunity?

**The Process notes still describe a Microsoft 365 world — OneDrive files, `.xlsx` workbooks, SharePoint
lists — but the data lives in Postgres and the steps run inside RoleProof. Ten of these notes are loaded
verbatim as LLM system prompts, so the staleness is not merely cosmetic: it is instruction.**

`lib/prompts.ts` `STEP_NOTE` loads ten notes as system prompts: **B2, B3, B4, B5, B6, C2, C3, C5, C7,
O2-extract**. Everything in them reaches the model.

Three distinct problems, which need three different fixes:

**(a) Input sources that no longer exist.** Notes tell the model to read `Profile_Reference_Workbook.xlsx`,
`Job Hunting Lists.xlsx`, or a OneDrive path. The model has no filesystem. B3 judges language roadblocks
"based on the information in my `tbl_Languages` from `Profile_Reference_Workbook.xlsx`"; B6 names
`tbl_Bullet_Bank` as its "primary reference". Reference counts measured 2026-08-01: **B5 11, B6 8, C2 8,
B3 4, B2 4, B4 2**; C3/C5/C7 clean.

This is not hypothetical. B2's §A pointed at the OneDrive JD path while the app passed the JD inline; it
was corrected on 2026-08-01 (`2a0115b`) and is the template for the rest.

**(b) Field names in a vocabulary the database does not use.** The notes specify SharePoint list columns —
`Initial_Match_Strength`, `Requirement_Group`, `Lead: ID`, `Requirement_Line` — with no stated relationship
to the tables that actually store them. Anyone reading a note against the schema has to guess, and the
guess is sometimes wrong (see the `rank` / `requirement_group` inversion in §2.2).

**(c) Output sections describing deliverables the app never produces.** Several notes carry a `## D`
section specifying a markdown table, "an interactive HTML widget with a Copy button", and a tab-delimited
SharePoint export. Counts of Output/D headings among loaded notes: B2 3, B5 3, B6 3, C2 2, B3 1. The app
persists through tool calls and Drizzle writes; none of these artifacts exist.

**Why now:** the B2 investigation showed the notes are load-bearing on model behaviour, not just
documentation. Anything in them that cannot be followed is either noise consuming context or an
instruction that actively misleads.

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:** the ten notes in `STEP_NOTE`, plus `Process/+ Job Hunting Master Instructions.md` §0.2 (the
File Map table) since it is the index everything else points at.

**Out of scope:**
- ~~**B6's §2 evidence instructions**~~ — **exclusion lifted 2026-08-01**: the B6 CI landed on `main`, so
  B6 is now fully in scope. Its note's `tbl_Bullet_Bank` reference is no longer a dead pointer — the bank
  is really sent — so the wording needs repointing at the DB rather than deleting. Re-read B6's note
  against the merged implementation before editing.
- Notes not loaded as prompts (A1, B1, C1, C4, C6) — stale references there mislead humans only. Lower
  priority; do them after, or in their own pass.
- Changing any step's *methodology*. This CI repoints references; it does not re-specify what a step does.

### 2.1 Principle — these notes are dual-purpose

Each note is simultaneously a human methodology document and a machine system prompt. Edits must serve
both. That rules out two tempting shortcuts: deleting the sections outright (humans lose the record) and
stripping them at load time in `lib/prompts.ts` (the doc keeps saying something untrue).

The B2 §A fix is the pattern to copy: state what is true now, forbid the impossible action, and keep the
retired path as a marked historic note.

### 2.2 Canonical mapping — workbook / SharePoint → Postgres

**Re-verified against `lib/db/schema.ts` and `lib/pipeline/screening.ts` on current `main`,
2026-08-01, after the B6 CI merged.** The pre-B6 version of this table was wrong in three places; the
corrections are marked ✅ below and the superseded rows are recorded in §4. Put this table in
`docs/DATA_MODEL.md` and have the notes reference it rather than each note inventing its own wording.

| Note says | Actually is |
| --- | --- |
| `Profile_Reference_Workbook.xlsx` | the Career Graph tables (below) |
| `tbl_Bullet_Bank` | `bullet_bank` — and since the B6 CI this is **really sent** to B6 (`gatherB6Evidence`), so the note's reference is repointed, not deleted |
| `tbl_Skills_Master` | `skills_master` |
| `tbl_Education` | `education` |
| `tbl_Languages` / `tbl_Language` | `languages` |
| `tbl_STAR_Actions` | `star_actions` (also `stars`, `star_results`, `star_competences`, `star_attributes`) |
| `tbl_Responsibilities` | `responsibilities` |
| `Job Hunting Lists.xlsx` / SharePoint | `job_leads`, `job_requirements`, `requirement_tailoring`, `cv_variants` |
| "Job Requirements List" (§3.1) | `job_requirements` |
| "Requirements Tailoring List" (§3.2) | `requirement_tailoring` |
| *(no workbook or SharePoint equivalent — it postdates them)* | ✅ `requirement_evidence` — B6's requirement→evidence map (`schema.ts`, migration `0032`). Many-to-many by design: one requirement is routinely carried by several bullets. Rows are replaced wholesale on each scoring run |

Field-level, for `job_requirements`:

| SharePoint field | Column | Note |
| --- | --- | --- |
| `Lead: ID` | `job_lead_id` | |
| `Requirement_Order` | `requirement_order` | global counter |
| `Rank` | `group_rank` | the within-group counter — **not** `rank` |
| `Requirement_Group` | `rank` | ⚠️ **inverted**: `rank` holds the group name; the column literally named `requirement_group` is a dead duplicate — see `[[Retire the requirement_group Duplicate Column]]` |
| `Requirement` | `requirement` | |
| `Requirement_Description` | `description` | |
| `Source Text` | `source_text` | |
| `Skills` | `skills` (jsonb) | |
| `Initial_Match_Strength` | `initial_match_strength` | |
| `Initial_Key_Strengths` | `initial_key_strengths` | ✅ written by B6 (`screening.ts` `initialKeyStrengths`) |
| `Initial_Missing_Weak` | `initial_missing_weak` | ✅ written by B6 (`screening.ts` `initialMissingWeak`) |
| `Initial_Score` | `initial_score` | |
| `Requirement_Line` | — | computed for display, not stored |

The two `Initial_*` rows above **used to say "currently never written"** and no longer do. The B6 CI
closed that gap: B6 already emitted `keyStrengths`/`gaps`, the columns had existed since `0000`, and
only the write path was missing. Blanks are normalized to null (`nullIfBlank`), so an `IS NOT NULL`
read means B6 genuinely had something to say. See
`[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]` §2.3.

### 2.3 Decision — what to do with the Output sections

**Replace each `## D` / Output section with a short "Persistence" subsection** naming the tool, the code
path, and the destination table. This is the answer to "make justice to what is executed, or at least
indicate this is handled by that part of the app" — it does both in three lines, serves the human reader,
and stops the model treating a template table as content to reproduce.

Recommended shape, using B2 as the worked example:

> ## D. Persistence
>
> This step emits a single `emit_requirements` tool call. The app validates it
> (`lib/llm/schemas.ts` → `B2.zod`) and writes one `job_requirements` row per requirement
> (`lib/pipeline/screening.ts`). No standalone output, export or table is produced — do not generate one.
>
> *Historic (superseded): this step previously produced a markdown table and a tab-delimited SharePoint
> export, back when it ran through the Microsoft 365 connector.*

Two reasons this specific shape matters. B2's old §D.1 contained a **template table with placeholder cells**
(`[short label]`, `[verbatim JD sentence]`), and during the B2 investigation the model was observed emitting
the literal value `placeholder` — a template in the prompt is a thing the model may copy. And the explicit
"do not generate one" is what makes the section useful as an instruction rather than merely descriptive.

### 2.4 Order of work

1. `docs/DATA_MODEL.md` — add the §2.2 mapping table (single source of truth)
2. `Process/+ Job Hunting Master Instructions.md` §0.2 File Map — repoint the four rows at the DB
3. B5 (11 refs, worst) → C2 (8) → B3 (4) → B4 (2) → B2's remaining `## D` (4)
4. B6 — **only if the B6 CI has landed**
5. C3, C5, C7, O2-extract — verify clean, no edits expected

### 2.5 Acceptance criteria

- [x] `docs/DATA_MODEL.md` carries the mapping table — plus `requirement_evidence` in the schema tables
      and the relationship diagram, and the "Sources" section moved to past tense
- [x] No loaded note instructs the model to open a file, workbook, SharePoint list or OneDrive path —
      audit down from 7/9/2/11/9/20 refs (B2/B3/B4/B5/B6/C2) to 3/2/2/3/3/3, every remaining hit being
      either the prohibition itself or a marked historic note
- [x] Every Output/`## D` section replaced with a Persistence subsection naming tool + code path + table
      — zero `## Output` / `## D. Outputs` headings remain across all ten loaded notes
- [x] No template/example tables with placeholder cells remain in any loaded note — bracket-placeholder
      count across the six edited notes fell 39 → 11, the remainder being prose examples, not table cells
- [x] Retired paths kept as marked historic notes, not deleted
- [x] **Dev server restarted** — run from the worktree so the edited notes were the ones on disk
      (`noteCache` never invalidates, so this had to be a cold start)
- [x] One live B-phase run per edited step; `cache[w=… r=0]` on the `[llm]` line confirms the new bytes
      loaded, and output quality is unchanged or better — see §4, 2026-08-02 live run. **C2/C3/C5 were
      not exercised live** (they need a lead promoted to tailoring); they rest on the backtest alone
- [x] `npx tsc --noEmit` clean; `npx vitest run` passing (171/171, 15 files); `verify-b6-evidence.ts`
      13/13 — **necessary but not sufficient, and not evidence about the notes at all**: no test reads a
      step note's body (see §4, step 0)
- [x] **§2.6's backtest green against the recently scored leads** — this is the real gate. 102 paired
      live calls over the 7 most recently scored leads: 0 model failures, and candidate better than
      baseline on every reliability measure that moved (see §4, 2026-08-02)

### 2.6 The gate — a read-only backtest, not the type checker

Because `tsc` and `vitest` cannot see into a note, the merge gate is an A/B backtest over the leads
that were most recently scored for real. What is under test is **the reliability of the scoring
process running** — that each step still emits its tool call, the payload still validates, every
requirement is still covered, every citation still resolves. Score *values* are reported for
visibility and are deliberately **not** a pass/fail condition: this CI repoints references, and a
judgment that moves half a point is not a regression.

`scripts/backtest-notes.ts`, modelled on `scripts/measure-b6-required.ts`:

- **Read-only by construction.** It calls each step's LLM directly rather than through
  `runScoring`/`runScreening`, so nothing is written to `job_leads`, `job_requirements` or
  `requirement_evidence`. The only rows it creates are `llm_calls` audit rows, tagged
  `<STEP>-backtest-base` / `-cand` so they stay separable from production traffic.
- **A/B without stashing.** The baseline note is read via `git show main:Process/<file>`, the
  candidate from the working tree. Both variants exist at once; no note swapping, and the run is
  repeatable.
- **Sampled, not single-shot.** The sibling CI established that a strict-schema collapse is
  *probabilistic* — B2 went ~0/17 to 13/14, which one run either side could not have shown. B6 is run
  three times per variant per lead.

**Blocks the merge:** any hard failure (no tool call, schema rejection, `stop_reason` `max_tokens` or
`refusal`) the baseline did not also produce · B6 requirement coverage below baseline · any fabricated
citation · any template leak (the literal `placeholder`, or `[short label]`-style bracket cells — the
§2.3 rationale, since B2 was observed emitting `placeholder` verbatim).

**Investigate, don't auto-block:** candidate input tokens *rising*. These notes get shorter; a rise
means something was added rather than removed.

**Report only:** score drift, flag counts, recommendation changes.

---

## 3. Resources or references

- **Precedent:** `[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]` §2.4 —
  the §A fix and its exact wording; §3.3 — the original reference audit this CI is built from.
- **Siblings:** `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]` ·
  `[[Retire the requirement_group Duplicate Column]]` ·
  `[[Complete Required Lists on the Remaining Strict Tool Schemas]]`
- **Code:** `lib/prompts.ts` (`STEP_NOTE`, `systemPromptFor`, `noteCache`) · `lib/db/schema.ts` ·
  `lib/pipeline/screening.ts` · `lib/pipeline/tailoring.ts` · `docs/DATA_MODEL.md`
- **Audit command:**
  `grep -icE "onedrive|obsidian vault|\.xlsx|sharepoint" "Process/<note>.md"` per note in `STEP_NOTE`.

---

## 4. Notes / Progress log

### 2026-08-01 · Opened

Raised by Reggie while closing the B2 work: the notes still name the workbooks as input sources, the
SharePoint field names have no stated relationship to the Postgres schema, and the Output sections describe
artifacts the app never produces. Reference counts and the field mapping in §2.2 are measured against the
current schema, not recalled.

The Output-section decision (§2.3) is the part that needed a call rather than an audit: replace with a
Persistence subsection naming the tool, code path and table — serving the human reader and the model at
once. Nothing implemented.

### 2026-08-01 · B6 merged — re-verify §2.2 before starting

The B6 CI landed on `main` after this note was written. Two consequences:

1. **The §2.0 exclusion on B6 is lifted** (struck through above). B6 is in scope.
2. **§2.2 is stale in at least two places and must be re-verified against current `main`, not trusted.**
   The merge added a `requirement_evidence` table that the mapping table does not mention, and it may have
   started writing `initial_key_strengths` / `initial_missing_weak`, which §2.2 records as "currently never
   written". Re-run the audit before relying on any row.

Do this re-verification as step 0. The Procedure's "current state audit, checked fresh rather than assumed
carried over from an earlier chat" exists for exactly this.

### 2026-08-01 · Step 0 done — §2.2 re-verified and corrected

Branch `claude/jobleads-scoring-backtest-35d61c`. Checked against `lib/db/schema.ts` and
`lib/pipeline/screening.ts` on current `main`. The previous entry predicted two stale rows; there were
**three**.

| §2.2 said | `main` says | Verdict |
| --- | --- | --- |
| `Initial_Key_Strengths` "currently never written" | `screening.ts` writes `initialKeyStrengths` in the B6 block | **wrong — corrected** |
| `Initial_Missing_Weak` "currently never written" | `screening.ts` writes `initialMissingWeak` in the same block | **wrong — corrected** |
| (no row at all) | `requirement_evidence` exists — `schema.ts`, migration `0032`, applied to the live DB | **missing — row added** |
| trailer: "Flag them to the B6 CI rather than fixing here" | the B6 CI already fixed them | **obsolete — replaced with a pointer to it** |

Re-confirmed as still correct, so the rest of the table can be trusted: the `rank` /
`requirement_group` inversion (`rank` holds the group name; `requirement_group` is the dead
duplicate), `Rank` → `group_rank`, and `tbl_Bullet_Bank` → `bullet_bank`.

**One finding that changes how this CI must be verified.** The only consumers of `Process/*.md` are
`lib/prompts.ts` (step notes → system prompts) and `scripts/seed.ts` (which reads `CI/*.md`
frontmatter only). **No test reads a step note's body.** `tsc` and `vitest` are therefore structurally
incapable of catching a bad note edit — a note can be gutted and CI stays green. §2.5's last two
criteria are not a supplement to the type/unit gate here; they are the *only* gate. Hence the
read-only backtest harness added as §2.6.

### 2026-08-01 · The noise floor — and a pre-existing B6 defect the backtest found

Before editing anything, `scripts/backtest-notes.ts` was run with **both variants pointing at the
unedited notes** — a deliberate no-op A/B, B6 × 3 leads × 3 runs, to measure how much two byte-identical
prompts differ. The answer is: more than enough to make a naive gate useless.

| Lead | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| Senior Manager, Advisory · EPAM | 18/18 · 18/18 | 18/18 · 18/18 | 18/18 · 18/18 |
| Head of Group FP&A · Signify | 12/12 · 12/12 | 12/12 · 12/12 | 12/12 · 12/12 |
| Associate Director, Strategy & Transformation · Riverflex | 17/17 · 17/17 | **1/17 · 2/17** | 17/17 · 17/17 |

*(baseline · candidate, requirements judged out of requirements on file)*

**Two conclusions, and the second one is not about this CI.**

1. **The gate has to be relative, not absolute.** Mean coverage came out 89.6% baseline vs 90.2%
   candidate on identical prompts, and each side produced one template leak. A rule like "no leaks" or
   "coverage must be 100%" fails a change that does nothing at all. Every §2.6 condition is therefore
   phrased as *worse than baseline*, with a 5-point tolerance on mean coverage — and collapse **count**
   as the un-averaged signal, since a mean built from eight perfect runs and one catastrophic one
   describes neither.

2. **B6 collapses probabilistically on `main` today.** On the Riverflex lead, one run in three returned
   1 of 17 requirements and emitted the literal string `placeholder` — the same signature the B2
   investigation documented, on both variants, with nothing changed. B2 has a re-ask guard for exactly
   this (`tooThin` / `ATTEMPTS` in `screening.ts`); **B6 has none**, so a lead scored during a collapsed
   run gets a real-looking `overall_fit_score` computed from one requirement. Out of scope here —
   raised separately. Worth knowing that any lead already scored may have been scored this way.

### 2026-08-01 · Implemented — all ten loaded notes, plus the index and the data model

Branch `claude/jobleads-scoring-backtest-35d61c`.

**Two enabling production changes, both pure refactors.** `composeSystemPrompt(step, note)` is now
exported from `lib/prompts.ts` and used by `systemPromptFor`; each step's user message is now built by
an exported pure function (`b2UserMessage` … `b6UserMessage` in `screening.ts`, `c2UserMessage` in
`tailoring.ts`). Both exist so the backtest sends what production sends. A harness that rebuilt these
strings locally would drift the first time a call site changed and would then certify a prompt the app
never sends — worse than no backtest. Covered by `tsc`, `vitest` and `verify-b6-evidence.ts` (13/13).

**§2.4 order, all steps done.**

| # | Target | What changed |
| --- | --- | --- |
| 1 | `docs/DATA_MODEL.md` | The corrected §2.2 mapping table, as the single source of truth. The "Sources" section moved to past tense — the workbooks were the one-time import, not a live input. `requirement_evidence` added to the pipeline table and the relationship diagram. |
| 2 | Master Instructions §0.2 | The File Map no longer lists OneDrive paths and connector columns. It now says what a step actually receives and points at `DATA_MODEL.md`. §3 (was "SharePoint / Output Conventions", `Field: [value]` templates) repointed too — §2.2 names §3.1/§3.2 directly, so it is part of the same mapping surface. |
| 3 | **B5** (worst: 11 refs) | §B step 1 read a `.md` from OneDrive and looped a batch; both gone. §D.1's empty-celled 17-dimension table and §D.2's SharePoint export replaced by §D Persistence. The *definitional* A–Q table in §A stays — it is the framework the step reasons with, not an output template. |
| 4 | **C2** (20 refs) | The Reference format was a table path (`Tbl_STAR_Actions > Action_ID 5-3`) into the workbook; it is now "cite the exact ref code from the listing you were given", with the kinds the listing actually uses. §G Output → Persistence, naming `requirement_tailoring` and stating that `approval_status` is the human's, not the model's. |
| 5 | **B3** | The profile facts (§A languages, §B/§C missing lists) are stated in the note itself and always were — the pointers at `tbl_Languages` / `tbl_Skills_Master` implied a lookup the model cannot do. §F → Persistence. |
| 6 | **B4** | `tbl_Locations` → the `offices` table, with the lists restated inline. §D → Persistence. |
| 7 | **B2** | §A was already fixed (`2a0115b`); its §D.1 template table and §D.2 export are now Persistence. |
| 8 | **B6** | Exclusion lifted. `tbl_Bullet_Bank` **repointed, not deleted** — the bank is really sent now, so §A describes the three supplied blocks. §B.1.2 rewritten around `evidenceRefs` being an array. §D.1/§D.2 → Persistence, naming all three write targets. |
| 9 | **C3, C5** | Not clean after all: both carried an Output section describing an artifact the app never produces (C3 an expanded C2 export table; C5 "store the Profile in the Job Lead folder", plus permission to emit 1–2 labelled variations into a slot that holds one). Both now Persistence. C7 and O2 audited clean, unedited. |

**Two instruction bugs found and fixed while repointing** — neither is a stale reference, both would
have reached the model:

1. **B3 and B4 both said: "if no roadblocks / misalignments are found, write `None`."** Against the
   current schema that reads as *emit an entry whose detail is `None`* — recording a roadblock called
   "None" on a clean lead. The correct instruction is an empty array, and the note now says so and says
   why the old sentinel existed.
2. **B6's header told the model to check which model it was running as and prompt the user to switch.**
   The app selects the tier and the step can only emit a tool call; the instruction was unfollowable.

**Net size.** 54.1 KB → 57.1 KB across the six edited prompt notes: B2 −795 B and B5 −2.1 KB, but B3,
B4, B6 and C2 grew, because the Persistence sections carry operational content that was not there
before (field→column mappings, the empty-array correction, the "citations are verified" rule).
**Template placeholder cells fell from 39 to 11.** The growth is instruction, not decoration, and it
sits in the 1h-cached prefix — but §2.6 flags an input-token rise deliberately, so it is recorded here
rather than waved past.

**Files:** `docs/DATA_MODEL.md` · `Process/+ Job Hunting Master Instructions.md` · `Process/B2` `B3`
`B4` `B5` `B6` `C2` `C3` `C5` notes · `lib/prompts.ts` · `lib/pipeline/screening.ts` ·
`lib/pipeline/tailoring.ts` · `scripts/backtest-notes.ts` (new) · `.gitignore`.

### 2026-08-02 · Verification — §2.6 backtest, 102 paired live calls · **PASS**

> [!WARNING] The **B6** rows below are a historic record, not a reusable baseline
> Superseded on 2026-08-02 by the B6 collapse guard (`[[B6 Scores Requirements It Never Judged]]`,
> merged as PR #3). That change added a `Return exactly N entries in "requirements"` instruction to
> `b6UserMessage` in `lib/pipeline/screening.ts` — and `scripts/backtest-notes.ts` calls that same
> builder, precisely so the harness sends what production sends. So the message B6 receives today is
> **not** the message these numbers were measured against, and comparing a fresh B6 run to them would
> attribute the difference to the wrong change.
>
> Re-measure B6 before using it as a baseline again. The B2/B3/B4/B5/C2 rows are unaffected — their
> builders did not change. Worth doing on its own merits: that instruction may have moved the collapse
> rate by itself, which would be useful to know separately from the guard.

`npx tsx scripts/backtest-notes.ts --apply`. Read-only throughout: every step was called directly
rather than through `runScoring`/`runEvidenceMapping`, so no lead's score, requirements, evidence links
or tailoring rows were written. Cohort: the 7 most recently scored leads carrying both a JD and
requirements.

| Step | n (each side) | Baseline | Candidate |
| --- | --- | --- | --- |
| **B2** | 6 | 15.2 reqs · 100% source-text · 100% group-rank | 15.5 · 100% · 100% |
| **B3** | 6 | 0 roadblocks flagged | 0 — identical |
| **B4** | 6 | 1.7 misalignments flagged | 1.7 — identical |
| **B5** | 6 | 17/17 dimensions rated | 17/17 |
| **B6** | 21 | coverage **83.8%** · 4 collapsed · 4 leaked · 0 fabricated | coverage **90.8%** · **2** collapsed · **2** leaked · 0 fabricated |
| **C2** | 6 | coverage **63.5%** · 2 collapsed · 1 fabricated · 91.7% with CV slot | coverage **79%** · **1** collapsed · **0** fabricated · **100%** |

Zero model-level failures and zero bad `stop_reason` on either side. **The candidate is not merely
non-regressive — it is better than baseline on every reliability measure that moved.** B6 gained ~7
points of requirement coverage and halved both its collapse and leak rate; C2 gained ~15 points and
lost its fabricated citation.

**How much of that is real, honestly.** Not much of it should be claimed as an *improvement*. The
run-to-run variance on B6 and C2 is large enough that direction is readable but magnitude is not — an
earlier C2 pass at n=2 per lead showed the candidate 4-collapses-to-1 *worse*, and re-running the same
comparison unchanged flipped it to 1-to-2 *better*. What the 102 calls support is the claim the gate
actually makes: **nothing got worse.** Anyone reading the +7 and +15 as a win should re-run at higher n
first.

**The `placeholder` leak is now identified exactly**, which the earlier B2 investigation could only
infer. The field is B6's root-level `summary`, and the payload reads
`…"evidenceRefs":[],"evidenceNote":""}],"summary":"placeholder"}`. `summary` **is** in B6's `required`
list — so this is the limit of what a complete `required` list buys: it guarantees the key is present,
never that the value is meaningful. It happens on both variants, so it is pre-existing.

**C2's collapse mechanism is identified too, and it is the sibling CI's defect, not this one's.** The
collapsed payloads drop `connection` entirely, repeat the same link verbatim, and in one case appended
evidence text *into* `cvPosition`:

> `"cvPosition":"Professional Experience - A3. BBAG Wind Down Project the Project Plan and Budget with input from 10 department heads, driving regulatory, operational, legal, and financial closure end-to-end."`

That is constrained-grammar degradation, and `C2.tool` declares five properties on `links[]` while
requiring three — `connection` and `cvPosition` are the two omitted, and they are exactly the two that
misbehave. See `[[Complete Required Lists on the Remaining Strict Tool Schemas]]`. **B3, B4, B5, C3 and
C7 have the same shape of incomplete list** and should be checked in that CI, not this one.

**Four harness defects the run exposed, all fixed** — recorded because a gate that is wrong in the
permissive direction is worse than no gate:

1. **Line endings.** `core.autocrlf=true` means git stores LF and the Windows tree holds CRLF, so an
   untouched 272-line note read 272 bytes larger out of the working copy than out of `git show`. Every
   line of every note would have differed by whitespace and the "identical baseline" check could never
   have fired. Both sides are normalized now.
2. **A lead with 0 requirements was in the cohort.** Coverage is undefined there, `pct()` returned 0,
   and it counted as a collapse on *both* variants — six phantom collapses in the first full run.
3. **The gate blocked on a `fetch failed`.** A dropped connection with `out=0` says nothing about a
   prompt. Transport errors are now classified apart and never gate.
4. **Failed rows poisoned the averages.** An empty metric object made every numeric column fall back to
   printing raw value lists, so one dropped connection rendered the candidate column unreadable while
   baseline still showed clean means.

`npx tsc --noEmit` clean · `npx vitest run` 171/171 (15 files) · `verify-b6-evidence.ts` 13/13.

### 2026-08-02 · Live run in the app — criteria closed, and a defect found in passing

Dev server cold-started **from the worktree** (`npm run dev`, `https://localhost:3000`), so the notes on
disk were the edited ones — confirmed by the fresh `certificates/` directory Next.js wrote into the
worktree, and by the B6 note reading 11,375 bytes there against 9,705 on `main`. Reggie ran screening on
several leads, old and new, through the real UI.

**The cache criterion is met.** First call to every step shows a write with a zero read; every later call
reads the same prefix back:

```
B2 cache[w=3575 r=0]   B3 cache[w=4070 r=0]   B4 cache[w=2897 r=0]
B5 cache[w=4708 r=0]   B6 cache[w=8977 r=0]   A1 cache[w=1519 r=0]
```

Output quality unchanged; no `[B6] dropped …` citation warnings.

**Then the run surfaced the real shape of the B6 collapse — and it is worse than "sometimes returns
fewer requirements".** Two of the four B6 calls were 4.0s/256 tokens and 7.5s/430 tokens against 47.1s
and 32.4s for the healthy ones. Checking those leads in the database:

| Lead | reqs | scored **exactly 6.0** | keyStrengths | evidence links | overall |
| --- | --- | --- | --- | --- | --- |
| Chief Operating Officer (COO) | 18 | **17** | 1 | 6 | 6.6 |
| Head of Cost Management Green Industry | 11 | **10** | 0 | 4 | 6.3 |
| Senior Manager, Advisory | 18 | **16** | 2 | 4 | 6.8 |
| *Chief Consultant, Group COO Office* (healthy) | 14 | 0 | 14 | 53 | 8.2 |
| *Associate Director, Strategy* (healthy) | 17 | 5 | 17 | 58 | 7.5 |

**`screening.ts` writes `j?.score ?? 6` for any requirement B6 did not judge.** So a collapse does not
produce a visible gap: it produces a full set of requirements, every one scored, every one "Good", and a
plausible overall in the Proceed/Borderline band. Reggie went looking for missing requirements and
correctly found none — **the count is never what breaks.** Three of the last eight scored leads carry
fabricated scores, one of them from 08-01, before any of this work.

The reliable tells are `initial_key_strengths` (14/14 or 17/17 healthy, 0–2 collapsed) and the evidence
link count (53–58 healthy, 4–6 collapsed).

Out of scope here and **not** caused by this CI — the same rate appears on the unedited notes in §2.6's
no-op A/B. Raised as its own CI; the note edits ship on their own evidence.

**Also observed:** two B2 calls failed with `Anthropic 400 — credit balance is too low`. Both threw
before any write, so no lead was left half-scored. Worth noting that §2.6's backtest spends ~102 live
calls, 42 of them Opus, per full run.
