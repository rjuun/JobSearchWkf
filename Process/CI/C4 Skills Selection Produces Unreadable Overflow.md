---
ci-area: CV Tailoring
ci-roadmap:
ci-title: C4 Skills Selection Produces Unreadable Overflow
ci-status: 2 - Testing
ci-priority: high
ci-date: 2026-08-07
ci-estimated-time:
ci-time-spent: 0
pr-source: "[[CV Header, Skills & Professional Experience — Data-Driven Template Wiring]]"
pr-target: "[[C2. Map JD Requirements to Supporting Evidence]], [[C3. Transform Evidence into CV Bullets]], [[C4. Build and Manage the Skills Section]]"
---

---

## 1. What is the problem or opportunity?

Wiring C4's `skillsModel` into the real CV Word template for the first time (2026-08-07 — it had never been
fed into the real template before that day; only an unused `CvModel` fallback path consumed it) exposed
that C4 produced **67 skill names in a single "Proficient:" line** for one lead (`b7e91408-666b-
4bd3-9aa2-feb760fc1036`, Allianz Partners, 30 Keep rows). Per the user, directly: *"according to the C4
procedure, we could never have come to 67 skills!!"* — C4's own docstring targets "3–5 categories × 4–8
skills" (~12–40 range). 67 in one category is not a large-Keep-set edge case; it means something upstream
tagged far more densely or far more often than C4's design ever intended.

**A display-layer cap of 24 items was added the same day as a stopgap** (`templateSlotData`,
`lib/pipeline/tailoring.ts`) so the CV itself stays readable. It does not touch C4's selection logic, its
categorisation (`Expert`/`Proficient` by proficiency only — the thematic categories a real CV shows, e.g.
"Governance & Compliance", don't exist as data; tracked separately as ROADMAP P6), or the deliberately
uncapped "every Keep bullet's tag must appear" consistency rule that produced the 67 in the first place.
**The cap hides the symptom. The cause is still open.**

## 2. What would the improvement look like?

### 2.0 · Root cause, established 2026-08-23

**The fix is in C2, not C3 or C4's grouping** — and the design was already written down and never built.

[[Requirement Skills vs My Skills - Two-Column Redesign (Epic)]] §2 specified My Skills as *"the
candidate's own vocabulary for the same evidence — drawn from `skills_master`, and (pending Q3)
`star_competences` / `star_attributes`"*, and §5 flagged **Q3** as the one open question to settle
*before* the C4 rewrite. Q3 was never answered. The build shipped `mySkills: ev.skills` instead — a
verbatim copy of the evidence node's own free-text graph tags (`star_actions.skills`,
`responsibilities.skills`, `bullet_bank.tags`) — which is neither `skills_master` nor the widened
set, but a third option the design never listed. The epic is marked `3 - Delivered`.

Measured against the live DB (read-only, `scripts/audit-c4-skills-density.ts`):

| | |
| --- | --- |
| Distinct graph tags across the profile | **246**, over 104 evidence rows (354 occurrences) |
| Used exactly once | **180** of 246 |
| Present in any curated table | **8** of 246 |
| Curated vocabulary that exists and was bypassed | `skills_master` 25 + `star_competences` 27 + `star_attributes` 18 |
| Stored My Skills on the Allianz lead the profile recognises | **11 of 68** |

So the 67 is arithmetic, not an edge case: 64 Keep rows × ~2.8 raw tags, uncapped. And because
`catFor` decided the category by looking the name up in the curated map that recognised almost none
of them, all 67 landed in a single "Proficient" bucket — the *unreadable* half of the title is as
much that as the count.

Two further findings that reframed the fix:

- **C2 was never asked about skills at all**, which is why its note has no paragraph describing
  `my_skills` — the app filled the column behind the model's back, exactly the way it carries
  `original_text`. C2 was also never sent the requirement's own `Requirement Skills`, so half of the
  requirement↔skills pair it is meant to match against was missing from its prompt.
- **The old consistency rule guarded a correspondence that did not exist.** Its stated rationale is
  "prevents a skill referenced in the experience section but missing from the Skills overview" — but
  nothing about `my_skills` is ever rendered with a bullet. Bullets print as plain text; their skills
  are the bracketed or bolded `Requirement Skills`.

### 2.1 · Decisions (Reggie, 2026-08-23)

1. **Epic Q3 — answered: all three tables.** A JD doesn't distinguish a skill from a competence from
   an attribute, even though the profile tables do.
2. **The CV Skills section prints `Requirement Skills`, for requirements with matched evidence only**
   — i.e. the skills genuinely carried by the tailored bullets (bracketed or bolded inline), scoped
   to the Keep-gated rows, ordered Core → Important → Nice-to-Have.
3. **Both halves land in this CI**, rather than splitting the C2 rewrite out.

### 2.2 · What was built

- **C2 selects My Skills.** New `mySkills` on the `emit_evidence_map` link schema; the owner's
  curated vocabulary is supplied as a second cached prompt block; the write path validates every
  returned name against it and drops what it doesn't recognise, the same treatment an invented ref
  code gets. Carry-forward rows (no model call) resolve the evidence node's tags through the same
  index, so free-text vocabulary is dropped there too.
- **C2 is sent the full pair.** Each requirement now carries an `asking for:` line — its B2
  `Requirement Skills` — because a requirement and its skills are one mutually-explaining pair.
- **C4 rebuilt** on `lib/pipeline/skills.ts` (`buildSkillsSection`): Keep rows' `requirement_skills`,
  grouped by the matched requirement's rank, each skill printed once under its highest rank.
- **The 24-item display cap is gone.** C4 bounds its own output to C4 §B.1's envelope and sheds only
  *Additional Skills* — Core and Important are never truncated, because each answers a requirement
  with matched, human-kept evidence behind it.
- Matching is **exact only** (name or ATS keyword variant). A token-overlap matcher was prototyped
  and rejected: it mapped the bare tag "Leadership" onto "Change Management" via that skill's
  "change leadership" variant. A near-miss on a CV is a claim the candidate never made.

### 2.3 · Acceptance

- [x] The Allianz lead's Skills section is readable: **68 → 16**, one category, all Core.
- [x] No raw graph tag can reach the CV — every My Skills value is validated against the vocabulary.
- [x] `npm run typecheck` clean; 226 tests pass, 17 of them new (`lib/__tests__/c4-skills.test.ts`).
- [x] Strict-schema audit clean after the `emit_evidence_map` change.
- [ ] **Live verification pending — needs a paid run.** The new C2 selection path has not been
      exercised against a real Opus call.
- [ ] **Already-mapped leads keep stale `my_skills`, and a C2 re-run does NOT fix them.** Corrected
      2026-08-23 after initially claiming the opposite. `planMerge` only writes `my_skills` on the
      `toReplace` path (new evidence scoring *strictly* higher, which also resets the row to
      `pending` and costs the approval). Rows that merely match again land in `unchanged` and are
      not touched at all; `toRefresh` patches `evidence_kind` only. The Allianz lead's 64 green rows
      were carried forward at their requirement's own `initialMatchStrength`, so a re-run proposes
      identical refs at identical strengths — every row is `unchanged`, and its 68 free-text tags
      persist indefinitely.
      **Consequence:** the CV is correct (C4 no longer reads `my_skills`), but the workspace's "My
      Skills" badges keep showing the old tags, which reads as "nothing changed". Only a *new* lead
      exercises the corrected C2 path end to end.
      **Options:** a deterministic backfill script (resolve stored `my_skills` through
      `buildVocabIndex`/`resolveVocab` and rewrite — no LLM, no approval reset; would take Allianz's
      68 tags to its 11 recognised names), or accept the staleness on historical leads and verify on
      a new one.

### 2.4 · Deliberately out of scope

- **Thematic categories** ("Governance & Compliance", "Process & Transformation") — ROADMAP P6. The
  headings shipped here are rank-derived, which is the only taxonomy that exists as data today.
- **Curating the 246 graph tags.** They stay as graph provenance, which is what they are; they simply
  no longer reach the CV. Nothing depends on cleaning them now.
- **Requirement Skills content quality.** The 16 that now print include "Fluency in German and
  English" and "MS Office Proficiency" (requirement labels rather than skills), and the near-duplicate
  pair "Decision Documents Preparation" / "Communications & Decision Documents Preparation". Split out
  as [[Skill Name Treatment in the C4 Skills Section]] — note that CI reopens the "not C4 selection"
  framing, since C4 is the only step that sees the assembled set and therefore the only one that can
  detect a near-duplicate at all.

## 3. Resources or references

- `lib/pipeline/skills.ts` — new. The two pure decisions: `buildVocabIndex`/`resolveVocab` (what may
  become a My Skills value) and `buildSkillsSection` (what the CV prints). Tested in
  `lib/__tests__/c4-skills.test.ts`.
- `lib/pipeline/tailoring.ts` — `gatherSkillVocabulary`, the C2 write paths (model + carry-forward),
  `c2UserMessage`, the rebuilt C4 block, and `templateSlotData` where the 24-item cap was removed.
- `lib/llm/schemas.ts` — `mySkills` on `C2.zod` and the `emit_evidence_map` tool schema.
- `scripts/audit-c4-skills-density.ts` — read-only before/after probe over every lead with Keep rows.
- [[Requirement Skills vs My Skills - Two-Column Redesign (Epic)]] — §2 target design, §5 Q3.
- Follow-ons opened from this CI: [[Skill Name Treatment in the C4 Skills Section]] (what the printed
  names read like) and [[Split cv_bullet_skills from requirement_skills]] (`requirement_skills` is
  written by C2 and then overwritten by C3, so the column means two different things at two different
  times — splitting it makes "which Requirement Skills did this bullet actually evidence" computable).
- `[[CV Header, Skills & Professional Experience — Data-Driven Template Wiring]]` — where the cap was added
  and where this was first surfaced; that note's progress log has the exact reproduction (lead id, counts).
- Memory: `c4-skills-overflow-bug.md` (auto-memory) — the same finding, saved for cross-session recall.

## 4. Notes / Progress log

### 2026-08-07 · Opened as an Idea

Surfaced while verifying the Skills tag wiring end-to-end against a real lead. The user explicitly asked
this be tracked as unresolved rather than considered closed by the display cap, and set it as the highest
priority of the three Ideas opened the same day.

### 2026-08-23 · Root-caused and built

Investigation ran read-only against the live DB first. The tag-volume numbers in §2.0 are what turned
the diagnosis from "C4 tags too densely" into "C2 was specified to select from the curated vocabulary
and instead copies raw graph text" — the epic's own §2, with its blocking Q3 unanswered.

Reggie's framing is what located it. He set out the process as he understood it — B2 produces the
`requirement` ↔ `requirement_skills` pair; C2 searches the Career Graph against *that pair* and, when
it finds evidence, records both the `original_text` and the corresponding `my_skill` — then said he
could not trace where `my_skills` was actually populated. He was right that he couldn't: C2's note
never mentioned the column, because the app was filling it without ever asking the model. That gap in
the documentation *was* the defect.

Also corrected in passing: the code comment at the C2 insert described `requirement_skills` as "(B5
output)". It is B2's — written at `screening.ts` in the `emit_requirements` insert; B5/B6 never touch
`job_requirements.skills`.

Docs rewritten to match the build: C2 §A/§B/§G (the missing My Skills paragraph, plus the vocabulary
block and the `asking for:` line), C4 §A/§B.2/§B.3/§D and its Notes, C3 §B.5's forward-reference,
`docs/PIPELINE.md`, `docs/DATA_MODEL.md`, and epic Q3 marked answered with the deviation from its §2
recorded (C4 prints `requirement_skills`, not `my_skills` — the inversion Reggie decided).
