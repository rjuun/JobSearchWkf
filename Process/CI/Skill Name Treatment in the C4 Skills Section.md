---
ci-area: CV Tailoring
ci-roadmap:
ci-title: Skill Name Treatment in the C4 Skills Section (Consolidation)
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-23
ci-estimated-time:
ci-time-spent: 0
pr-source: "[[C4 Skills Selection Produces Unreadable Overflow]]"
pr-target: "[[C4. Build and Manage the Skills Section]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] RE-SCOPED 2026-08-24 — this is now the CONSOLIDATION half
> Opened 2026-08-23 with three problems (§1 a/b/c). Two have since moved:
>
> - **(b) languages — SHIPPED.** C4 §B.4 declares it and `dropLanguageSkills` enforces it against the
>   owner's own `languages` rows. Nothing left to do.
> - **(c) JD-phrase-shaped names — MOVED** to [[C3 Writes CV-Grade Skill Tags]]. Those names come from
>   C3's tag, and the fix is a change of register at source, not a rewrite downstream.
>
> **What remains, and what this CI now is: (a) consolidation.** Turning
> "Cost Allocation · Cost Transformation · Cost Optimization · Cost Benefit Management" into
> "Transfer Pricing & Cost Optimization". That belongs here and can only live here: **C3 is called per
> evidence ref and never sees the assembled set**, so it cannot merge across bullets. C4 is the only
> step with whole-set vision.
>
> **Sequence it after [[C3 Writes CV-Grade Skill Tags]].** C3 changes what arrives; consolidating the
> current JD-shaped tags would be tuning against inputs that are about to change. The owner's plan
> (2026-08-24) is C3 first, then this.

---

## 1. What is the problem or opportunity?

[[C4 Skills Selection Produces Unreadable Overflow]] fixed *how many* skills print and *where they come
from*: the CV Skills section is now the `requirement_skills` carried by Keep-gated rows, grouped by the
matched requirement's rank. The Allianz Partners lead went from 67 names in one line to 16 in one
category. That CI deliberately stopped there — **selection** was its scope.

It did not touch **what those names read like**, and on the very first lead the corrected selection
surfaces three distinct content problems. All 16 below are real output from
`scripts/audit-c4-skills-density.ts` against lead `b7e91408` (Allianz Partners):

> Core Competencies: Decision Documents Preparation · Executive Support · Precise Written
> Communication · Stakeholder Management With Senior Leadership · Governance Process Ownership ·
> Organizational Skills & Network Building · International Stakeholder Collaboration · Work
> Autonomously · Communications & Decision Documents Preparation · Audit & Compliance Coordination ·
> MS Office Proficiency · Budgeting & Planning Support · Transformation Initiative Execution ·
> Meeting & Event Management · Fluency in German and English · Team Player & Cooperation

**a. Near-duplicates.** "Decision Documents Preparation" and "Communications & Decision Documents
Preparation" both print. C4 dedupes on exact normalised string, so two wordings of one capability
survive as two entries. C4 §D already says *"Do not duplicate skills unnecessarily across categories"*
— it has no rule for duplication *within* one, because it never had to.

**b. Names that belong in another section, or in no section.** "Fluency in German and English" is a
language — the CV has a dedicated Languages section, filled straight from the profile tables, so this
prints the same fact twice in two different shapes. "MS Office Proficiency" is table stakes for the
role and arguably weakens a senior CV by being listed as a competency at all.

**c. Names that are requirement labels, not skills.** "Work Autonomously" and "Team Player &
Cooperation" read as JD phrasing lifted whole. They are what the posting *asks for*; a skills line
wants what the candidate *has*. C4 §B.4 already asks for *"skill names concise and consistent in
style"* without defining what that means operationally.

**Why this is a C4 problem and not only an upstream one.** The names originate upstream — B2 §3.6
extracts Requirement Skills in the JD's own language (correct, and deliberately so: it is what drives
ATS matching), and C3 §B.5 writes the bracketed tag per bullet. Both are behaving as specified. But C4
is the step that decides what *prints*, and it is the only step that sees the whole set at once —
which is the only vantage point from which "these two are the same capability" is even visible. A
treatment applied at B2 or C3 cannot see the duplicate; a treatment at C4 can.

Note the constraint this sits under: the same JD language that reads awkwardly is what makes the
Skills header and the bullets' bracketed tags agree word-for-word, which was the explicit reason the
parent CI chose `requirement_skills` as the source. **Any cleanup that rewrites a name away from the
JD's wording weakens ATS matching**, and that trade has to be made deliberately rather than by a
tidy-up pass that doesn't know it is making it.

## 2. What would the improvement look like?

Not scoped — deliberately. The owner's instruction was to *declare* the treatment, and he believes one
may already exist. Sequence:

1. **Find the existing rule first.** Search the Process notes for what has already been decided about
   skill naming, language-as-a-skill, generic tooling, and duplicate suppression — C1 (overall content
   and format guidance) is the most likely home, then C4 §B.4/§D, C3 §B.5's "Consistency of Bracketed
   Tags", and B2 §3.6. If a rule exists, this CI is about *enforcing* it in code and citing it in C4,
   not inventing one.
2. **Decide where each of the three problems is treated**, which may be three different answers:
   - near-duplicates → almost certainly C4 (only it sees the whole set)
   - languages / generic tooling → possibly an exclusion list, possibly C1 formatting guidance,
     possibly B2 (don't extract them as skills at all)
   - JD-phrase-shaped names → possibly C3's tag wording, possibly a C4 display-name mapping
3. **Decide the ATS trade explicitly.** Options range from "print the JD wording verbatim, always"
   (max ATS, current behaviour) through "collapse duplicates but never reword" to "map to a canonical
   display name and keep the JD variant for ATS". Note that `skills_master.ats_keyword_variants`
   already models exactly this two-names-one-skill idea for the curated vocabulary, and may be the
   right shape here too.
4. **Then** write the rule into `Process/C4...md` and implement it in `lib/pipeline/skills.ts`
   (`buildSkillsSection`), where the parent CI left a single normalised-exact-match dedupe.

**Explicitly out of scope:** where C4 sources from, and its categorisation — both shipped on
[[C4 Skills Selection Produces Unreadable Overflow]] (§2.13; the categories are thematic now, built by
a Sonnet call, not the rank labels an earlier draft of this note described). Also out of scope: the
*register* of individual names — that is [[C3 Writes CV-Grade Skill Tags]].

**The guard is the shared risk.** Consolidation means printing a name that is not literally one of the
selected skills, which `reconcileSkillGroups`' identity check currently rejects — the same check
[[C3 Writes CV-Grade Skill Tags]] §2.4 has to replace. **Do not build two different replacements.**
Whichever CI lands first should establish support-plus-coverage, and the second should reuse it.

The ATS worry that shaped the original draft turned out to be unfounded, and it is worth not
re-discovering: consolidating by **joining** rather than substituting is keyword-*denser*, not
sparser. "Corporate Governance & Regulatory Compliance (EBA)" carries three matchable terms where
"Governance" carries one. Keep the JD's words inside the compound entry and nothing is lost.

## 3. Resources or references

- `lib/pipeline/skills.ts` — `buildSkillsSection`; the dedupe is a normalised exact-string match on
  `norm()` (lowercase + collapsed whitespace), which is what lets (a) through.
- `lib/__tests__/c4-skills.test.ts` — existing coverage for selection and dedupe; new naming rules
  belong here.
- `scripts/audit-c4-skills-density.ts` — read-only; prints the current Skills section for every lead
  with Keep rows. Run this first to see whether the three problems generalise beyond the one lead.
- `Process/C4. Build and Manage the Skills Section.md` — §B.4 Formatting Guidelines, §D Quality &
  Consistency Rules. The two places a rule would live.
- `Process/C1. Overall Application Content and Format Guidance.md` — check here first for the existing
  treatment the owner expects to find.
- `Process/C3. Transform Evidence into CV Bullets.md` §B.5 — "Consistency of Bracketed Tags" already
  asks for short, consistent tags across bullets; inconsistent tags are the direct upstream cause of (a).
- `Process/B2. Extract Requirements from Job Description.md` §3.6 — why the names carry JD language.
- [[C4 Skills Selection Produces Unreadable Overflow]] §2.4 — where this was logged as out of scope.

## 4. Notes / Progress log

### 2026-08-24 · Re-scoped to consolidation only

Two of the three original problems moved out (see the callout above). What is left is the one thing
only C4 can do. Re-prioritised to `high` and sequenced after [[C3 Writes CV-Grade Skill Tags]] on the
owner's plan: *"My hunch is, to implement: C3 Writes CV-Grade Skill Tags, Skill Name Treatment in C4,
and continue testing the other CIs."*

The §2 archaeology step is now largely done and its answer was **no pre-existing rule** — C4 §D
forbade duplication *across* categories and said nothing about duplication *within* one, which is
exactly the gap. Do not re-run that search from scratch.

### 2026-08-23 · Opened as an Idea

Split out of [[C4 Skills Selection Produces Unreadable Overflow]] at the owner's request, on seeing that
CI's verified output. His reasoning for opening it rather than accepting the names: *"it is good to have
it declared before just letting it slip by."*

The parent CI's own §2.4 recorded these three as out of scope on the grounds that they are B2 extraction
and C3 tag wording rather than C4 selection. That framing is worth re-examining as the first act of this
CI — C4 is the only step that sees the assembled set, which is the sole vantage point from which a
near-duplicate is detectable at all.
