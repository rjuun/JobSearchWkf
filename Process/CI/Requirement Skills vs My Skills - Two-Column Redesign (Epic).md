---
ci-title: Requirement Skills vs My Skills — Two-Column Redesign (Epic for Claude Code)
ci-area: Screening (B4-B5) / Tailoring (C2-C4, C7)
ci-status: 1 - Development
ci-priority: high
ci-date: 2026-07-22
ci-estimated-time: 6
ci-time-spent:
pr-source: "[[Introduce Requirement Skills to Job Requirements List]]"
pr-target: "[[B4. Translate Requirements to Areas of Expertise and Define JD Groups]], [[B5. Extract Requirements from Job Description]], [[C2. Map JD Requirements to Supporting Evidence]], [[C3. Transform Evidence into CV Bullets]], [[C4. Build and Manage the Skills Section]], [[C7. Run Reviewed ATS Matching Rating]]"
---
---

```simple-time-tracker
{"entries":[{"name":"Segment 1","startTime":"2026-07-22T20:14:07.959Z","endTime":"2026-07-22T20:46:06.214Z"}]}
```

---

## 0. Why this is its own epic, not a note edit

[[Introduce Requirement Skills to Job Requirements List]] is marked "3 - Delivered" but that only reflects the Obsidian documentation edit (renaming a column header, adding notes). Nothing in the running app — schema, pipeline code, or the live prompts in `Process/*.md` — has actually changed. This note is the build spec for the real implementation: schema + pipeline + prompts together, because none of the three can move alone without breaking the other two.

This is Bucket 2 from the July reconciliation. Bucket 1 (safe prompt-only edits: B2/B3/C1/C2/C5) is already merged.

---

## 1. What is broken today (verified against the running code, 2026-07-22)

**a. B5 asks the LLM for the wrong thing.** `Process/B5. Extract Requirements from Job Description.md` §C.5 tells the model to populate `Skills` with the B4 Areas-of-Expertise codes (A–Q). That's the exact problem the source CI note flags: the Skills column should be the literal skill/keyword language used *in the JD requirement*, not the candidate's 17-dimension AoE framework. `lib/llm/schemas.ts` (`B5.zod`) and `lib/pipeline/screening.ts` (~L155-168) just pass through whatever the prompt produces, so the bug lives in the prompt, not the code.

**b. C2 mislabels "My Skills" as `actual_skills`.** `lib/pipeline/tailoring.ts:205` writes `actualSkills: ev.skills` — i.e. it copies the *evidence node's own* skill tags (from `star_actions.skills` / `bullet_bank.tags`). That's genuinely a "My Skills" value. But there is no sibling column carrying the JD-language "Requirement Skills" this evidence is supposed to demonstrate — `job_requirements.skills` for the matched requirement is never copied across at C2 time.

**c. C3's skill judgment is computed and then thrown away.** `C3.zod` (`lib/llm/schemas.ts:349-354`) has the model return a `skills` array per bullet, and the prompt (`Process/C3...md` §B.5, "Skill Association") is written around exactly this — the bracketed tag at the end of each bullet is meant to be the Job-Lead-facing skill language. But `lib/pipeline/tailoring.ts:285-293` only persists `cvBullet` back to `requirement_tailoring`; the returned `skills` are used in-memory for one paragraph and then discarded. Nothing durable captures "which Job Lead skill does this bullet prove."

**d. C4 ignores C2/C3 entirely.** `lib/pipeline/tailoring.ts:296-331` builds the CV Skills section from a fresh token-overlap ranking against `skills_master`, independent of anything decided in C2 or C3. The "Consistency Rule" in `Process/C4...md` (every skill named in a bullet must appear in the top Skills List) is only enforced against the ephemeral in-memory `bulletByRef` map from this same run — never against real, reviewable data.

**e. The reviewer can't see any of this.** `app/roleproof/leads/[id]/page.tsx:82-102` maps `requirements` and `tailoring` rows into the UI but drops `job_requirements.skills`, `requirement_tailoring.actual_skills`, and `connection_to_expertise` entirely. There is currently no way to see, let alone correct, either skills column during the Keep/Maybe/Drop gate.

---

## 2. Target design

Two columns, two distinct meanings, both real and both visible:

| Column | Lives on | Meaning | Populated by |
|---|---|---|---|
| **Requirement Skills** | `job_requirements.skills` (exists) + new `requirement_tailoring.requirement_skills` | The skill/keyword language *as the JD states it* — what this requirement (or this piece of evidence) is proving to the employer. Never AoE codes. | B5 (requirement-level) → copied into C2 rows for the matched requirement |
| **My Skills** | `requirement_tailoring.actual_skills`, renamed `my_skills` | The candidate's own vocabulary for the same evidence — drawn from `skills_master`, and (pending Q3 below) `star_competences` / `star_attributes` | C2 (from the evidence node) → refined by C3's bracketed-tag judgment |

B4's 17-dimension AoE framework stays scoped to JD Group discovery only (per Reggie's own clarification in the source CI note) and stops leaking into either column.

C4 stops recomputing skills from scratch — it builds the CV Skills List primarily from the Keep-gated rows' `my_skills`, and checks coverage against `requirement_skills` for the Consistency Rule, instead of a parallel heuristic that nothing else in the pipeline agrees with.

---

## 3. Concrete changes, by layer

### Schema (`lib/db/schema.ts` + new `drizzle/00XX_*.sql`)
- Rename `requirement_tailoring.actual_skills` → `my_skills` (straight rename; ~27 rows in the current DB per `docs/DATA_MODEL.md`, no dual-write needed).
- Add `requirement_tailoring.requirement_skills jsonb default '[]'`.
- Update `docs/DATA_MODEL.md` line 52 and `docs/PIPELINE.md` lines 80-81 to match.

### Pipeline (`lib/pipeline/tailoring.ts`, `lib/pipeline/screening.ts`, `lib/llm/schemas.ts`)
- **C2** (`tailoring.ts` ~L195-211): when inserting each row, add `requirementSkills: req.skills` (the matched `job_requirements` row's own skills — JD language) alongside the renamed `mySkills: ev.skills`.
- **C3** (`tailoring.ts` ~L265-293): stop discarding `r.data.bullets[].skills`. Write it back — e.g. `.set({ cvBullet: rewritten, requirementSkills: bulletByRef.get(row.evidenceRef)?.skills })` — since C3's bracketed-tag judgment is specifically about Job-Lead-facing skill language, per `Process/C3...md` §B.5. Update the `C3` tool description in `lib/llm/schemas.ts:356-358` to say so explicitly (it currently just says "tag the skills demonstrated," ambiguous between the two columns).
- **C4** (`tailoring.ts` ~L296-331): rebuild from the Keep-gated `requirement_tailoring.my_skills` (deduped across `green` rows) as the primary source for `skillsModel`; fall back to the existing `skills_master` overlap ranking only to fill remaining category slots. Run the Consistency Rule against `my_skills` / `requirement_skills` already in the DB instead of the throwaway `bulletByRef` map.
- **B5** (`screening.ts` ~L142-170): no code change — behavior follows directly from the prompt fix below.

### Prompts (`Process/*.md` — loaded live via `lib/prompts.ts`)
- **B4.md**: add the clarifying note from the CI discussion — AoE codes (A–Q) are for JD Group discovery only, never a stand-in for Requirement Skills or My Skills downstream.
- **B5.md** §C.5: replace "Write Skills as the connected Skills/AoE codes from the framework (A–Q)…" with an instruction to extract 2–6 literal skill/keyword phrases in the JD's own words, decoupled from the AoE framework. Remove the CI callout in this file once shipped.
- **C3.md** §B.5 ("Skill Association"): clarify that the bracketed tag = Requirement Skills (Job-Lead language), and note that "My Skills" sourcing may draw on `tbl_STAR_Competences` / `tbl_STAR_Attributes` in addition to `tbl_Skills_Master` — pending Q3 below.
- **C4.md** §A: update to describe building the Skills List from the already-approved My Skills rows, cross-checked against Requirement Skills coverage, rather than an independent pass.
- **C7.md**: currently `pr-status: Development` and still written around the old "Connection to Areas of Expertise" table shape. Needs its own rewrite once B4–C4 land — treat as a fast-follow, not a blocker for this epic. Reggie's still-open ask in that note (a feedback loop before/after the Summary Scorecard) is unrelated to this redesign and should stay a separate CI item.

### UI (`app/roleproof/leads/[id]/page.tsx`, `components/roleproof/workspace`)
- Surface `job_requirements.skills` (Requirement Skills) in the requirements list.
- Surface `requirement_tailoring.my_skills` and `.requirement_skills` as two visible fields on each Keep/Maybe/Drop review row.
This is the part that makes the redesign actually usable — right now Reggie has no way to see either column while reviewing, so a backend-only fix would be invisible.

---

## 4. Suggested build order

1. Schema migration + `schema.ts` rename/add.
2. C2 write (`requirementSkills` + renamed `mySkills`) — cheapest, makes data start flowing.
3. C3 write-back of its skills judgment.
4. C4 rebuilt off real data.
5. UI surfacing (so each prior step's output is checkable as it lands).
6. Prompt edits to B4/B5/C3/C4.
7. `docs/DATA_MODEL.md` + `docs/PIPELINE.md` updates.

Existing `requirement_tailoring` rows won't have `requirement_skills` populated until C2 is re-run for those leads — fine for a single-user app, no backfill script needed.

---

## 5. Open decisions for Reggie — resolve before or during the build

- **Q1** — Rename the `skills_master` / "Skills and Areas of Expertise" table label to just "Areas of Expertise"? (Naming only; doesn't block the schema work above.)
- **Q2** — Rename the C4 step/file to reflect its coordinating role ("Coordinate the description of Skills between Bullets and Generation of Skills List") rather than "Build and Manage the Skills Section"?
- **Q3** — Should "My Skills" sourcing formally widen to `star_competences` + `star_attributes`, not just `skills_master`? This changes what C4's query pulls from and is the one open question with real code impact — recommend deciding this one before Claude Code starts on the C4 rewrite.

---

## 6. Source notes

- [[Introduce Requirement Skills to Job Requirements List]] — original problem statement + Reggie's clarifications (Q1–Q3 above are lifted from its "topic for discussion" section).
- [[B4. Translate Requirements to Areas of Expertise and Define JD Groups]], [[B5. Extract Requirements from Job Description]], [[C2. Map JD Requirements to Supporting Evidence]], [[C3. Transform Evidence into CV Bullets]], [[C4. Build and Manage the Skills Section]], [[C7. Run Reviewed ATS Matching Rating]]
- Code verified against: `lib/db/schema.ts`, `lib/pipeline/tailoring.ts`, `lib/pipeline/screening.ts`, `lib/llm/schemas.ts`, `app/roleproof/leads/[id]/page.tsx`, `docs/DATA_MODEL.md`, `docs/PIPELINE.md`.
