---
ci-title: Repoint the Process notes from workbooks and SharePoint to the app
ci-area: Process notes / prompt hygiene
ci-roadmap:
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-01
ci-estimated-time: 5
ci-time-spent: 0
pr-source:
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Self-contained
> Written to be picked up in a fresh chat. §1 is the problem, §2.2 is the canonical name mapping, §2.3 is
> the decision on Output sections. Sibling:
> `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]` — do **not** edit B6's
> §2 here, that CI owns it.

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
- **B6's §2 evidence instructions** — owned by
  `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]`, which is *supplying*
  the Bullet Bank. Fix B6's other references here only if that CI has already landed; otherwise leave B6
  alone entirely to avoid two CIs editing one file.
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

Verified against `lib/db/schema.ts` on 2026-08-01. Put this table in `docs/DATA_MODEL.md` and have the
notes reference it rather than each note inventing its own wording.

| Note says | Actually is |
| --- | --- |
| `Profile_Reference_Workbook.xlsx` | the Career Graph tables (below) |
| `tbl_Bullet_Bank` | `bullet_bank` |
| `tbl_Skills_Master` | `skills_master` |
| `tbl_Education` | `education` |
| `tbl_Languages` / `tbl_Language` | `languages` |
| `tbl_STAR_Actions` | `star_actions` (also `stars`, `star_results`, `star_competences`, `star_attributes`) |
| `tbl_Responsibilities` | `responsibilities` |
| `Job Hunting Lists.xlsx` / SharePoint | `job_leads`, `job_requirements`, `requirement_tailoring`, `cv_variants` |
| "Job Requirements List" (§3.1) | `job_requirements` |
| "Requirements Tailoring List" (§3.2) | `requirement_tailoring` |

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
| `Initial_Key_Strengths` | `initial_key_strengths` | currently never written |
| `Initial_Missing_Weak` | `initial_missing_weak` | currently never written |
| `Initial_Score` | `initial_score` | |
| `Requirement_Line` | — | computed for display, not stored |

The two "currently never written" rows are real gaps, not mapping errors: `screening.ts` writes only
`initialScore` and `initialMatchStrength`. Flag them to the B6 CI rather than fixing here.

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

- [ ] `docs/DATA_MODEL.md` carries the mapping table
- [ ] No loaded note instructs the model to open a file, workbook, SharePoint list or OneDrive path
- [ ] Every Output/`## D` section replaced with a Persistence subsection naming tool + code path + table
- [ ] No template/example tables with placeholder cells remain in any loaded note
- [ ] Retired paths kept as marked historic notes, not deleted
- [ ] **Dev server restarted** — `lib/prompts.ts` `noteCache` never invalidates
- [ ] One live B-phase run per edited step; `cache[w=… r=0]` on the `[llm]` line confirms the new bytes
      loaded, and output quality is unchanged or better
- [ ] `npx tsc --noEmit` clean; `npx vitest run` passing (notes are not compiled, but the seed/CI tests
      read some of them)

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
