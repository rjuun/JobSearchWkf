---
ci-area: CV Tailoring (C3 / C4)
ci-roadmap:
ci-title: C3 Writes CV-Grade Skill Tags
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-24
ci-estimated-time: 4
ci-time-spent: 0
pr-source: "[[C4 Skills Selection Produces Unreadable Overflow]]"
pr-target: "[[C3. Transform Evidence into CV Bullets]], [[C4. Build and Manage the Skills Section]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Handover note — written to be picked up in a fresh chat with no prior context
> The owner approved the direction (2026-08-24) and asked for this to be written up before the
> session ended. **§5 is the session state**: what shipped this week, what is still under test, and
> what is merely open. Read §1 and §2 before touching code; the whole point of this CI is a change of
> *register*, and the failure mode is doing it as a lookup.
>
> This supersedes a decision from [[Requirement Skills vs My Skills - Two-Column Redesign (Epic)]] —
> see §2.2. Do not treat that epic as settled law on this point.

---

## 1. What is the problem or opportunity?

The CV's Skills section is now correct in structure and wrong in *voice*. Selection, prioritisation,
categorisation and language-exclusion all work (§5). What prints still reads like a job posting rather
than a senior CV.

The owner's own pre-app CVs, built by hand through Claude Chat, are the benchmark. Real output,
2026-08-24 (ALDI SÜD lead) beside a real hand-built example:

| The app printed | The owner would write |
| --- | --- |
| Governance · Corporate Governance · Process Governance | **Corporate Governance & Regulatory Compliance (EBA)** |
| Cost Allocation · Cost Transformation · Cost Optimization · Cost Benefit Management | **Transfer Pricing & Cost Optimization** |
| Process Standardization · Process Harmonization | **Process Standardization & Automation** |
| Stakeholder Management | **Senior Stakeholder Management** |
| Team Leadership · Team Development | **Multi-Country / Cross-Cultural Leadership** |

Two patterns account for nearly all of it:

**A · Consolidation.** Several facets of one capability print as ONE compound entry, not four atoms.
This is why the hand-built sections hold 16–20 entries and the app's sprawled to 28 — and why the
hand-built ones never show near-duplicates.

**B · Level.** Every entry states the seniority, scale or scope it was exercised at:
"Large-Scale Transformation Leadership", "Senior Stakeholder Management", "Board-Level Partnering",
"Board-Grade Synthesis", "Multi-Country". This is what makes it read as a director's CV rather than a
competency inventory.

Three smaller ones: parenthetical anchors (`(EBA)`, `(Influence Without Authority)`); no table-stakes
tooling ("MS Office Proficiency"); no JD phrasing lifted whole ("Work Autonomously", "Team Player &
Cooperation").

### 1.1 · Why C3 produces JD-shaped tags: it is obeying

Not a model failure. `Process/C3…md` §B.5 explicitly instructs it:

> The bracketed tag carries **JD-compatible language** (`Requirement Skills`) … Traceability to your
> own profile runs through **My Skills** [which is not what the tag is].

C3 writes "Work Autonomously" because it was told to mirror the posting. **The instruction is the
defect.**

### 1.2 · And it has never seen the vocabulary

`c3UserMessage` sends the role line plus, per row: ref, requirement line, original text, and that
row's `my skills`. **C3 has never received `skills_master`** — not the 25 names, not the ATS keyword
variants. It cannot write in a register nobody has shown it.

**`skills_master` IS that register.** Verified against the owner's hand-built CVs — one entry is
verbatim identical, and the rest are the same shape:

| `skills_master` | Hand-built CV |
| --- | --- |
| Target Operating Model Design | **Target Operating Model Design** *(identical)* |
| Executive Communication & Board Reporting | Board Partnering & Executive Communication |
| Corporate Governance + Regulatory Compliance (EBA / Banking) | Corporate Governance & Regulatory Compliance (EBA) |
| Process Standardization & Harmonization | Process Standardization & Automation |
| Cross-Cultural Leadership | Multi-Country / Cross-Cultural Leadership |
| Financial Planning & Analysis | FP&A & Performance Reporting |

Those CVs were written out of this table. The table exists, is curated, is 25 rows, and no step that
writes display text has ever been shown it.

## 2. What would the improvement look like?

### 2.1 · The owner's framing, which is the scope

> *"Just as the Job Descriptions are a population reflection, and hence a low level document which
> mixes skills, competences and attributes, also the naming of the skills is lower than my CV-Grade
> standards, so it is better to depart from the strict Job Description wording for a more
> professional tuned skill names."*

One refinement, agreed in the same exchange: the JD anchoring **was not a mistake being corrected.**
It is right for `requirement_skills` — what the role asks, ATS-facing — and wrong only for what
prints. The two could not diverge until [[Split cv_bullet_skills from requirement_skills]] gave them
separate columns. This CI is the second half of that split finally paying off.

### 2.2 · Matching and naming are different jobs — this is the key design point

The owner's question: *"How to strictly use `skills_master` to serve as CV-Grade naming without
losing the possibility of having competences and attributes as matching?"*

They do not conflict, because they happen at different steps:

| Step | Question it answers | Vocabulary |
| --- | --- | --- |
| **C2** | Which of my capabilities does this evidence demonstrate for this requirement? | **All three tables — UNCHANGED.** Epic Q3 stands. |
| **C3** | What does the bullet print? | **`skills_master`'s register** |

A JD asking for discretion or resilience under scrutiny is genuinely answered by an *attribute*, so C2
must keep all three or the match is lost. The attribute is **input to the tag, not the tag**.

**The owner's own CV already proves the mechanism:**

| Profile table | What the CV printed |
| --- | --- |
| `Confidentiality & Trust` (attribute) | Confidentiality & Discretion |
| `Good Listener` + `Mediator` (attributes) | Neutral Sounding Board |
| `Resilience` + `Tolerance for Stress` (attributes) | Resilience & Composure Under Pressure |
| `Conflict Resolution / Mediation: Acting as Mediator` (competence) | Conflict Mediation |

None of those four printed names is in `skills_master`. The attributes came through — re-expressed.

**Therefore `skills_master` is the register EXEMPLAR, not a filter, and not a closed list.** Building
this as a lookup is the way to get it wrong. Further proof it cannot be a lookup: "Board-Grade
Synthesis", "Neutral Sounding Board", "Governance Operating Rhythm" and "Executive Advisory" all
appear in hand-built CVs and in no table.

### 2.3 · What C3 needs

1. **`skills_master` in the prompt** — 25 names + ATS variants, one cached block, the same shape as
   the vocabulary block `c2UserMessage` already builds. Cheapest item, biggest effect.
2. **§B.5 reversed** — see §1.1. Knowingly: this overturns the Requirement Skills vs My Skills epic's
   ruling that the tag is JD-facing language.
3. **The style rules written into §B.5** — consolidate not enumerate; state the level; parenthetical
   anchors where they add precision; no table-stakes tooling; no JD phrasing lifted whole; no
   languages (already shipped, C4 §B.4).
4. **A replacement guard** — see §2.4.

### 2.4 · The guard change, which is the risk

Today's containment is identity: `reconcileSkillGroups` drops any printed name that is not literally
one of the selected skills. **That is what stopped the 67-skill problem, and this CI removes it** — a
coined name like "Transfer Pricing & Cost Optimization" would be rejected as an invention.

What replaces it, both weaker than a lookup:

- the tag must be **supported by the bullet it sits on** — a judgement, which is why C3 is Opus; and
- a **coverage check**: every curated `my_skill` on the row is represented by some tag, so a
  capability cannot silently vanish.

Do not skip this. The original defect was an unguarded path, and this CI reopens one deliberately.

### 2.5 · The half C3 cannot do

**Consolidation needs whole-set vision. C3 is called per ref, one bullet at a time**, and structurally
cannot turn four Cost-* entries into one — it never sees the four together. Only C4 does.

So the work splits: **C3 delivers the register** (compound, level-stating, CV-grade individual names);
**C4 delivers the consolidation** over the assembled set. Neither alone reproduces the benchmark. A
plan that puts everything in C3 will fall short and it will not be obvious why.

### 2.6 · Second-order benefit worth keeping

When C3 repeatedly needs a name `skills_master` lacks, that is a signal the table should grow.
"Executive Advisory", "Board-Level Partnering", "Governance Operating Rhythm" look like missing
entries. Surfacing C3's coinages as candidate additions — for the owner to curate — makes the register
improve itself. Not required for v1; do not let it block.

### 2.7 · Acceptance

- [ ] A generated CV's Skills section is indistinguishable in register from the hand-built examples:
      3–5 categories, 4–8 entries each, compound and level-stating, no near-duplicates, no languages,
      no table-stakes tooling, no JD phrasing.
- [ ] Total 16–20 entries (the benchmark), not 28.
- [ ] C7's ATS rating does not regress. **Baseline: 88/100 on lead `69bc2e13`, 2026-08-24.** ATS
      should be neutral-to-better — `skills_master` names plus variants carry more matchable keywords
      than the atomised versions ("Corporate Governance & Regulatory Compliance (EBA)" = three terms;
      "Governance" = one).
- [ ] No printed skill is unsupported by its bullet (§2.4).

## 3. Resources or references

- `lib/pipeline/tailoring.ts` — `c3UserMessage` is inline in the C3 block (not a named builder like
  `c2UserMessage`); the C3 draft/absorb loop; the C4 block with `prioritiseSkills` →
  `dropLanguageSkills` → `emit_skill_groups` → `reconcileSkillGroups`.
- `lib/pipeline/skills.ts` — all the pure logic, with `reconcileSkillGroups`'s identity guard (§2.4).
- `lib/pipeline/tailoring.ts` `gatherSkillVocabulary` — already loads all three tables for C2; C3
  needs `skills_master` only.
- `lib/llm/schemas.ts` — `C3.tool` (`emit_cv_bullets`), `C4.tool` (`emit_skill_groups`).
- `Process/C3…md` §B.5 — the instruction to reverse. `Process/C4…md` §B.1/§B.3/§B.4 — current rules.
- `lib/__tests__/c4-skills.test.ts` — 25 tests; the guard tests are the ones §2.4 changes.
- `scripts/audit-c4-skills-density.ts` — read-only, stops at prioritisation.
- [[Skill Name Treatment in the C4 Skills Section]] — opened earlier for the same symptom from the
  C4 side; **this CI probably absorbs it.** Reconcile the two before starting.

## 4. Notes / Progress log

### 2026-08-24 · Opened, direction approved

Reached at the end of a long session that fixed everything around it (§5). The owner: *"I understand
you chose C4 for controlling the output better. But I somehow know that C3 is the final CV-Grade I
would like to have."* He was right — C4 can only rearrange what C3 hands it.

Recorded for whoever picks this up: over that session the same class of error occurred three times —
a claim inherited and repeated without checking the source (ROADMAP P6, which says nothing about
skills), and twice a correction accepted and then re-made in a new form (rank labels → taxonomy
lookups). **When a correction lands here, check whether the next proposal is the same mistake wearing
different clothes.**

## 5. Session state at handover (2026-08-24)

**Shipped and merged to `main`, migrations applied.** Nothing is in flight; the tree is clean.

| CI | Status | Notes |
| --- | --- | --- |
| C4 Skills Selection Produces Unreadable Overflow | `2 - Testing` | C2 selects My Skills from curated tables; C4 = collect → prioritise → categorise (Sonnet call); display cap removed; languages struck. Verified live: 68 → 16 skills, then a 5-category section on ALDI. |
| Split cv_bullet_skills from requirement_skills | `2 - Testing` | Owner reports working. Column + migration `0037`, backfill applied (64 moved, 64 restored). Coverage-gap badge deliberately NOT shipped. |
| Lead Liveness Re-check and Not Pursued Reason Tags | `2 - Testing` | Owner reports working. LinkedIn guest-fragment re-read, migration `0038`, Not Pursued tags, run-trace re-run display. |
| B3 Raises False Roadblocks (Case Log) | `0 - Idea` | Case log, 2 entries. Do not design from it yet — owner's instruction. |
| Skill Name Treatment in the C4 Skills Section | `0 - Idea` | Likely absorbed by this CI — reconcile. |

**Verification gates:** `npm run typecheck` and `npm test` (257 passing) both clean from `main`.
`npm run lint` fails on a pre-existing eslint plugin issue — not a regression, do not chase it.

**Testing in progress:** the owner is running three leads through the full workflow —
`69bc2e13` (ALDI), `ee5c72bf` (Julius Baer), `a9f2307b` (Aliaxis). The acceptance table for the three
`2 - Testing` CIs is in the session; each CI's own §Acceptance carries its criteria.

**Environment:** dev server is `https://localhost:3000` (self-signed; the in-app browser refuses it,
so browser verification needs the real Chrome or a minted session cookie). `Process/*.md` notes are
the live prompts and are cached per-process — **restart the dev server after editing one.**
