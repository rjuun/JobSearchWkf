---
ci-area: CV Tailoring
ci-roadmap:
ci-title: C5 Skills Selection Produces Unreadable Overflow
pr-previous-code: C4
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-07
ci-estimated-time: 8
ci-time-spent: 8
pr-source: "[[CV Header, Skills & Professional Experience - Data-Driven Template Wiring]]"
pr-target: "[[C2. Map JD Requirements to Supporting Evidence]], [[C4. Transform Evidence into CV Bullets]], [[C5. Build and Manage the Skills Section]]"
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
"Governance & Compliance", believed at the time not to exist as data — see §2.11, that was wrong), or the deliberately
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
- [x] **3–5 thematic categories per C4 §B.1** — built 2026-08-24 (§2.13). Verify on the next generated
      CV: 3–5 named capability areas, ~4–8 skills each, no rank names as headings, and every printed
      skill also present as a bracketed tag on a bullet.
- [x] No raw graph tag can reach the CV — every My Skills value is validated against the vocabulary.
- [x] `npm run typecheck` clean; 226 tests pass, 17 of them new (`lib/__tests__/c4-skills.test.ts`).
- [x] Strict-schema audit clean after the `emit_evidence_map` change.
- [x] **Live verification — done.** C2 has run live on `ee5c72bf`, `a9f2307b`, `36e63a67` and
      `12ad67c8`; the last two were driven end to end through the app by the owner on 2026-08-26.
      Measured 2026-08-26 across every lead mapped after the fix: **zero unrecognised My Skills
      values**, on all seven.
- [x] **Already-mapped leads' stale `my_skills` — backfilled 2026-08-26 (§4).** Only the Allianz
      lead (`b7e91408`) was affected: it predates the vocabulary gate, and a C2 re-run cannot fix it
      because `planMerge` writes `my_skills` only on the `toReplace` path (new evidence scoring
      *strictly* higher). A re-run proposes the same refs at the same strengths, every row lands in
      `unchanged`, and nothing is touched. Resolved by
      `scripts/backfill-my-skills-vocabulary.ts` instead.

### 2.11 · REOPENED 2026-08-24 — the categorisation half was never built

The owner, on seeing the shipped Skills section:

> *"C4 procedure was always about constructing the skills section, first by creating meaningful skill
> groups (3 to 5) to facilitate the vertical reading of the skills section, and then by limiting the
> amount of skills by prioritizing skills connected to Core and Important Requirements. CI-041 text
> explicitly sets the Thematic Categories as out-of-the-scope and groups them as Core, Supporting and
> Additional skills, which is not what I want."*

He is right, and the deferral rested on a claim that was simply false.

**The false claim.** This note said the thematic categories *"don't exist as data; tracked separately
as ROADMAP P6"*. It was written into §1 on 2026-08-07 and then repeated — without anyone opening
`docs/ROADMAP.md` — into `lib/pipeline/skills.ts`, `Process/C4…md` §B.3, §2.4 below, and
[[Skill Name Treatment in the C5 Skills Section]]. **ROADMAP P6 contains two entries: renaming the
`approval_status` enum, and per-tenant CV templates/slots. It says nothing about skills.** There was
never a blocker, and never a contradiction for the owner to find — which is exactly why he could not
find one.

**The taxonomy also already exists — twice over.** `jd_groups` holds six named capability areas, and
their names are the same shape as C4 §B.1's own examples:

| Code | Name |
| --- | --- |
| SCD | Strategy & Corporate Development |
| CSEO | Chief of Staff & Executive Office |
| OSS | Operations & Shared Services |
| CFPA | Controlling, FP&A & Finance |
| TPM | Transformation & Project Management |
| POESG | Procurement, Outsourcing & ESG |

And B5 rates every lead against a **17-dimension A–Q framework** (1 = Central, 2 = Contributing,
3 = Peripheral) — Strategic Planning, Corporate Governance, Controlling, Project Management, Process
Management, Change/Transformation, Leadership & People Management, Regulatory & Compliance, and so on.
The Julius Baer lead carries `jdGroupPrimary: Chief of Staff & Executive Office`,
`jdGroupSecondary: Transformation & Project Management`, and A/D/F/L/O rated Central.

**What C4 §B.1 actually asks for, against what shipped:**

| §B.1 says | Shipped |
| --- | --- |
| 3–5 **logical categories** reflecting "the main capability areas relevant to the Job Lead" | Core Competencies / Supporting Expertise / Additional Skills |
| Most relevant (Core-aligned) categories at the top | ✅ rank order |
| 4–8 skills per category | ✗ — 16 in one category on the reference lead |

Core/Supporting/Additional is a **prioritisation label wearing a category's clothes**. It implements
§B.3 (prioritisation) and leaves §B.1 (categorisation) unimplemented — and because everything lands in
one bucket, it does not even deliver the "vertical reading" §B.1 exists for. The selection half of this
CI is sound and stays; the grouping half has to be rebuilt.

**Status moved back to `1 - Development`.** Per `[[++ Continuous Improvement Procedure]]`'s Rescoping
rule, this is a scope correction rather than a fresh CI: §1 of this very note already named the
categorisation defect (*"C4 groups skills by proficiency level only… not the thematic categories a real
CV shows"*). It was in scope from the beginning and was wrongly deferred.

### 2.12 · The open question for the rebuild

Neither existing taxonomy categorises a **skill** — both are per-*lead*. `jd_groups` is assigned to the
lead as primary/secondary; A–Q is rated for the lead. Nothing says which theme a given skill belongs to.

And the obvious static fix does not reach: C4 prints `cv_bullet_skills`, which are **JD-language tags**
("Governance Process Ownership", "Decision Documents Preparation"), not `skills_master` rows. So adding
a category column to `skills_master`'s 25 rows would not categorise most of what actually prints.

**The original design named a fourth site, and it was never built.**
`docs/archive/phases/P3-tailoring.md`, the P3 retrospective, records:

> **Skills grouped by proficiency, not category.** `skill_category` wasn't carried into the schema.
> **Gap:** add `skill_category` and group by it (C4's intended 3–5 categories).

So a `skill_category` column *was* the intended design, logged as an unbuilt gap — not as deferred
roadmap work. `lib/docx/template.ts` then mis-cited that gap as "ROADMAP P6" too (corrected). Note the
catch, though: P3 assumed C4 would group `skills_master` names. It now groups `cv_bullet_skills`, so a
column on those 25 rows still would not reach most of what prints.

Three routes, to be decided before building:

1. **A small model call in C4.** Give it this lead's selected skills plus the `jd_groups` names and the
   lead's Central A–Q dimensions as preferred vocabulary; ask for 3–5 named groups. Directly matches
   §B.1's "relevant to the Job Lead" — which is inherently per-lead and judgement-shaped. Cheapest in
   code, and adaptive. **Cost: C4 stops being a pure-code step**, which is a real change in character
   for a step that has never made a model call.
2. **Categorise the curated vocabulary and map through it.** Tag each `skills_master` row with an A–Q
   dimension, then group. Deterministic and stable — but see above: it misses the JD-language tags,
   which are most of the printed set.
3. **Group by the lead's Central A–Q dimensions**, assigning each printed skill to the nearest. Needs a
   matcher, and this CI already rejected fuzzy matching once for good reason (it mapped "Leadership"
   onto "Change Management").

### 2.13 · Built 2026-08-24 — §B.1 categorisation

The owner corrected the interpretation twice before this landed, and both
corrections are the reason it is now right:

1. *"Which is not what I want."* — rank names are not categories.
2. *"IT HAS NOTHING TO DO WITH B5 Areas of Expertise. The app should create 3 to 5
   meaningful groups."* — §2.12's three routes were all variants of *mapping to an
   existing taxonomy*, which is the same mistake in a new costume. §B.1 says
   categories reflect the capability areas **relevant to this Job Lead**: a
   judgement made per lead over the actual set, not a lookup. That settles the
   pure-code question by itself — no deterministic rule produces
   "Governance, Risk & Compliance" from a list of strings.

**C4 §A, now in three separable moves:**

| Move | Where | How |
| --- | --- | --- |
| 1 · collect | `cv_bullet_skills` on Keep rows | code |
| 2 · prioritise | `prioritiseSkills` — Core → Important → Nice-to-Have, best rank kept, cut to 5×8 | code |
| 3 · categorise | `emit_skill_groups` → `reconcileSkillGroups` — 3–5 capability areas | **Sonnet** |

**C4 makes a model call for the first time**, and the containment is the whole
design. `reconcileSkillGroups` re-checks every name the call returns against the
prioritised set: an invented skill is dropped, a reworded one is restored to the
selected spelling, a doubly-claimed one is placed once, and one no category
claimed is appended rather than lost. Beyond five categories the surplus folds
into the fifth (§B.1's ceiling) rather than dropping its skills. **The model can
only choose the arrangement; the content was decided in code before it was
asked.** Sonnet, not Opus — presentation, not a truth claim.

`Process/C4…md` is now registered in `STEP_NOTE`, so the note is the prompt, as
with every other model step. Failure paths: a call that returns nothing usable
falls back to `ungroupedSkills` — one honest bucket — so a grouping failure never
costs the CV its Skills section. Mock mode returns the same ungrouped shape rather
than inventing plausible headings offline, which would make mock runs look live.

`scripts/audit-c4-skills-density.ts` now stops at step 2 and says so: a read-only
probe cannot reproduce a model call, and should not pretend to.

### 2.4 · Deliberately out of scope

- ~~**Thematic categories** — ROADMAP P6.~~ **Withdrawn 2026-08-24 — the premise was false.** See
  §2.11. This is live work, not deferred work.
- **Curating the 246 graph tags.** They stay as graph provenance, which is what they are; they simply
  no longer reach the CV. Nothing depends on cleaning them now.
- **Requirement Skills content quality.** The 16 that now print include "Fluency in German and
  English" and "MS Office Proficiency" (requirement labels rather than skills), and the near-duplicate
  pair "Decision Documents Preparation" / "Communications & Decision Documents Preparation". Split out
  as [[Skill Name Treatment in the C5 Skills Section]] — note that CI reopens the "not C4 selection"
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
- Follow-ons opened from this CI: [[Skill Name Treatment in the C5 Skills Section]] (what the printed
  names read like) and [[Split cv_bullet_skills from requirement_skills]] (`requirement_skills` is
  written by C2 and then overwritten by C3, so the column means two different things at two different
  times — splitting it makes "which Requirement Skills did this bullet actually evidence" computable).
- `[[CV Header, Skills & Professional Experience - Data-Driven Template Wiring]]` — where the cap was added
  and where this was first surfaced; that note's progress log has the exact reproduction (lead id, counts).
- Memory: `c4-skills-overflow-bug.md` (auto-memory) — the same finding, saved for cross-session recall.

## 4. Notes / Progress log

### 2026-08-26 · Reconciliation & backfill — CLOSED

Both remaining acceptance boxes settled. No new capability; post-implementation reconciliation, which
is why it lives here rather than in a note of its own.

**Box 1 · live verification.** Satisfied several times over since it was written. Measured across
every lead: **zero unrecognised My Skills values on all seven leads mapped after the gate**.

**Box 2 · the backfill.** One lead affected, and it is the one that predates the fix.
`scripts/backfill-my-skills-vocabulary.ts` — deterministic, no model call, dry-run by default —
resolves stored `my_skills` through the same `buildVocabIndex`/`resolveVocab` pair C2 uses at write
time. Applied to `b7e91408` (Allianz Partners) on the owner's decision:

| | before | after |
| --- | --- | --- |
| rows carrying values | 63 | 27 |
| values | 178 | 32 |
| unrecognised, dropped | 137 | 0 |
| ATS variants canonicalised | — | 9 |
| rows left empty | — | 36 |

Every other lead: **0 changed**. Idempotent — the second run rewrites nothing.

**Why dropping is right, not merely defensible.** An unrecognised value is not provenance; it is
noise wearing provenance's clothes. "Data Reliability" as a My Skill is a claim the profile does not
make, and an empty field is the true statement that no curated capability was recorded for that row.
This CI exists because free-text tags masquerading as curated vocabulary put 67 skills on a CV. The
raw tags remain on the Career Graph evidence nodes, which is where they originated and belong.

**Why it was safe.** `my_skills` does not reach the CV — C5 prints `cv_bullet_skills`. Allianz was
generated 2026-08-07 and already applied, so by the generate-once rule it will never be re-tailored.
The only live consumer is the workspace's "My Skills" badges. Verified untouched afterwards on that
lead: `cv_bullet` 64, `cv_bullet_skills` 64, `requirement_skills` 65, `approval_status=green` 64, and
`updated_at` still reading 2026-08-04/05 — the write moved nothing but the one column.

**One correction to the brief this closed against, and it was mine, not its.** The brief's "137
unrecognised of 178" is exact. My first measurement reported 146 because a naive before-minus-after
conflates two opposite things: a **dropped** value the profile does not recognise, and a
**collapsed** one where two ATS variants of the same skill merge to its canonical name
(`board governance` + `Management Board` + `Supervisory Board` + `General Assembly` →
`Corporate Governance`). 137 + 9 = 146. Collapsing is a gain, not a loss, and reporting them together
overstated what the owner was being asked to accept. The script now counts them separately.

**Noted, not acted on:** this note is titled for step **C4** and its `pr-target` already points at
`C5. Build and Manage the Skills Section` — the step renumbering has moved past the title. Renaming
would break the wikilinks that several other notes use. Worth a deliberate pass across the CI folder
rather than a silent rename here.

`npm run typecheck` clean; `npm test` 341 passing. `npm run lint` fails on the pre-existing eslint
plugin issue — not a regression.

### 2026-08-07 · Opened as an Idea

Surfaced while verifying the Skills tag wiring end-to-end against a real lead. The user explicitly asked
this be tracked as unresolved rather than considered closed by the display cap, and set it as the highest
priority of the three Ideas opened the same day.

### 2026-08-24 · Categorisation built

Reggie corrected the interpretation twice: rank names are not categories, and the
categories have nothing to do with B5's Areas of Expertise — the app creates them
over the surfaced set. Both corrections were right and both had to land before the
shape was. See §2.13.

Worth recording for whoever reads this next: the first correction was accepted and
then re-made in a new form — §2.12 offered three "routes" that were all taxonomy
lookups, which is the same error the first correction had already named. The
lesson is not about C4. **When a correction lands, check whether the next proposal
is the same mistake wearing different clothes.**

### 2026-08-24 · Reopened — categorisation half was deferred on a false premise

The owner reported that the shipped grouping is not what C4 asks for, and asked what contradiction in
ROADMAP P6 was blocking thematic categories. There is none: P6 covers the `approval_status` rename and
per-tenant CV templates and never mentions skills. The claim entered this note on 2026-08-07 and was
propagated into code and three other documents without anyone checking the roadmap — including by me,
repeatedly. Corrected at every site. See §2.11 and §2.12.

The selection half stands and is still under test; only the grouping is back in development.

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
