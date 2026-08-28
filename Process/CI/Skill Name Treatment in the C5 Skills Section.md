---
ci-area: CV Tailoring
ci-roadmap:
ci-title: Skill Name Treatment in the C5 Skills Section (Consolidation)
pr-previous-code: C4
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-23
ci-estimated-time:
ci-time-spent: 3
pr-source: "[[C5 Skills Selection Produces Unreadable Overflow]]"
pr-target: "[[C5. Build and Manage the Skills Section]]"
---

---
```simple-time-tracker
{"entries":[{"name":"Delivered","startTime":"2026-08-26T17:44:54+02:00","endTime":"2026-08-26T17:44:54+02:00"}]}
```
---

> [!IMPORTANT] RE-SCOPED 2026-08-24 — this is now the CONSOLIDATION half
> Opened 2026-08-23 with three problems (§1 a/b/c). Two have since moved:
>
> - **(b) languages — SHIPPED.** C5 §B.4 declares it and `dropLanguageSkills` enforces it against the
>   owner's own `languages` rows. Nothing left to do.
> - **(c) JD-phrase-shaped names — MOVED** to [[C4 Writes CV-Grade Skill Tags]]. Those names come from
>   C4's tag, and the fix is a change of register at source, not a rewrite downstream.
>
> **What remains, and what this CI now is: (a) consolidation.** Turning
> "Cost Allocation · Cost Transformation · Cost Optimization · Cost Benefit Management" into
> "Transfer Pricing & Cost Optimization". That belongs here and can only live here: **C4 is called per
> evidence ref and never sees the assembled set**, so it cannot merge across bullets. C5 is the only
> step with whole-set vision.
>
> **Sequence it after [[C4 Writes CV-Grade Skill Tags]].** C4 changes what arrives; consolidating the
> current JD-shaped tags would be tuning against inputs that are about to change. The owner's plan
> (2026-08-24) is that CI first, then this.

---

## 1. What is the problem or opportunity?

[[C5 Skills Selection Produces Unreadable Overflow]] fixed *how many* skills print and *where they come
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
Preparation" both print. C5 dedupes on exact normalised string, so two wordings of one capability
survive as two entries. C5 §D already says *"Do not duplicate skills unnecessarily across categories"*
— it has no rule for duplication *within* one, because it never had to.

**b. Names that belong in another section, or in no section.** "Fluency in German and English" is a
language — the CV has a dedicated Languages section, filled straight from the profile tables, so this
prints the same fact twice in two different shapes. "MS Office Proficiency" is table stakes for the
role and arguably weakens a senior CV by being listed as a competency at all.

**c. Names that are requirement labels, not skills.** "Work Autonomously" and "Team Player &
Cooperation" read as JD phrasing lifted whole. They are what the posting *asks for*; a skills line
wants what the candidate *has*. C5 §B.4 already asks for *"skill names concise and consistent in
style"* without defining what that means operationally.

**Why this is a C5 problem and not only an upstream one.** The names originate upstream — B2 §3.6
extracts Requirement Skills in the JD's own language (correct, and deliberately so: it is what drives
ATS matching), and C4 §B.5 writes the bracketed tag per bullet. Both are behaving as specified. But C5
is the step that decides what *prints*, and it is the only step that sees the whole set at once —
which is the only vantage point from which "these two are the same capability" is even visible. A
treatment applied at B2 or C4 cannot see the duplicate; a treatment at C5 can.

Note the constraint this sits under: the same JD language that reads awkwardly is what makes the
Skills header and the bullets' bracketed tags agree word-for-word, which was the explicit reason the
parent CI chose `requirement_skills` as the source. **Any cleanup that rewrites a name away from the
JD's wording weakens ATS matching**, and that trade has to be made deliberately rather than by a
tidy-up pass that doesn't know it is making it.

> [!NOTE] Scope addition, 2026-08-24 — the envelope comes here; education does not
> **In: the section's size target.** `SKILLS_ENVELOPE = 40` (`lib/pipeline/skills.ts`) is not a
> considered number — it is C5 §B.1's ceiling, 5 categories × 8 skills, multiplied out. Measured on
> the two leads run after [[C4 Writes CV-Grade Skill Tags]] landed: 55 and 43 distinct tags arrived,
> and both printed **exactly 40**, so the cap is binding and set at twice the 16–20 benchmark. Nothing
> enforces the per-category half of the envelope either — `reconcileSkillGroups` caps categories at
> five but not their size, which is how Aliaxis printed a 12-entry category. Both belong here, because
> a size target without consolidation just sheds real capabilities instead of merging them.
>
> **Out: degrees printing as skills.** Julius Baer printed *Business Administration (Degree)*,
> *Economic Development (Master's)* and *Quantitative Asset & Risk Management (Postgraduate)*, all
> traced to `EDU-1/2/3` Keep rows. It reads like a sibling of the languages rule and it is not:
> [[C3 Selects the CV Evidence Set]] §2.4 excludes Education and Language refs from the bullet budget
> outright, so C4 never writes those tags and there is nothing left here to filter. Building a
> downstream rule for it would guard against something upstream already prevents.
>
> **Sizing follows selection, and neither closes it alone.** 14 bullets at ~2 tags each is ~28 tags —
> better than 55, still above the benchmark. The bullet budget gets it most of the way; consolidation
> closes the gap. Sequence this note last.

> [!IMPORTANT] Re-measured 2026-08-25, after C3 selection landed — the duplicate has CHANGED SHAPE
> The scope note below was written against the old output and its numbers are superseded. Two CIs have
> since reduced the section: [[C4 Writes CV-Grade Skill Tags]] raised the register, and
> [[C3 Selects the CV Evidence Set]] cut the bullet count to ~14. **`SKILLS_ENVELOPE = 40` no longer
> binds** — the leads now print 26 / 31 / 30 tags, under the cap and above the 16–20 benchmark. So the
> size target is no longer about a cap; it is entirely about merging.
>
> **And the duplicates are a different animal now.** They used to be JD-shaped atoms —
> *Governance · Corporate Governance · Process Governance*. What prints today is CV-grade compounds
> that differ only by their parenthetical qualifier, because C4 writes a tag per bullet and each bullet
> earns its own anchor. Julius Baer's six-strong stakeholder family:
>
> ```
> Senior Stakeholder Negotiation · Senior Stakeholder Coordination
> Senior Stakeholder Management (Multi-Entity) · Senior Stakeholder Management (Multi-Country)
> Senior Stakeholder Management (Board & Regulator) · Multi-Country Stakeholder Coordination
> ```
>
> plus *Board-Level Advisory* beside *Board-Level Strategic Advisory*. Aliaxis has four stakeholder
> variants; ALDI prints **Global Process Ownership & Governance** beside plain **Global Process
> Ownership** — one literally contains the other.
>
> **That last case is what `subsumedSkills` was built for** ([[C4 Writes CV-Grade Skill Tags]] §2.4).
> The guard already accepts a compound that contains selected skills whole and consumes them, so a
> merge cannot print beside its own parts. It has been inert since the day it shipped because C5's
> prompt still says copy every skill verbatim. **This CI's first job is to change what C5 is asked
> for** — the guard is waiting, not missing.
>
> The seam it leaves is unchanged and is the interesting problem: a merge only consumes atoms it
> literally contains, so *(Multi-Entity)* and *(Board & Regulator)* are not absorbed by any single
> compound. Deciding those are one capability is a claim about meaning, not spelling, which is why the
> grouping call has to declare what it merged. See that CI's §2.4 admonition for the mechanism.

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
   (`prioritiseSkills` collects and dedupes, `reconcileSkillGroups` decides what prints — the parent
   CI split the old `buildSkillsSection` into those two, and left the dedupe a normalised exact match).

**Explicitly out of scope:** where C4 sources from, and its categorisation — both shipped on
[[C5 Skills Selection Produces Unreadable Overflow]] (§2.13; the categories are thematic now, built by
a Sonnet call, not the rank labels an earlier draft of this note described). Also out of scope: the
*register* of individual names — that is [[C4 Writes CV-Grade Skill Tags]].

**The guard is the shared risk.** Consolidation means printing a name that is not literally one of the
selected skills, which `reconcileSkillGroups`' identity check currently rejects — the same check
[[C4 Writes CV-Grade Skill Tags]] §2.4 has to replace. **Do not build two different replacements.**
Whichever CI lands first should establish support-plus-coverage, and the second should reuse it.

> [!IMPORTANT] Landed 2026-08-24 on [[C4 Writes CV-Grade Skill Tags]] — do not rebuild it.
> `reconcileSkillGroups` now accepts a proposed name that is not in `selected` when it **contains**
> selected skills whole (`subsumedSkills` in `lib/pipeline/skills.ts`), and **consumes** them, so a
> merge can never print beside the atoms it absorbed. Containment is directional on purpose:
> "Governance" does not contain "Corporate Governance", so atomisation is still rejected. A name
> containing nothing is dropped exactly as before, which is what preserves the 67-skill containment.
>
> It is inert today — C4's prompt still says copy every skill verbatim — so **this CI's first job is
> to change what C4 is asked for**, not to change the guard.
>
> One seam it leaves you, and it is the interesting part of this CI: a merge only consumes the atoms
> it literally contains. "Transfer Pricing & Cost Optimization" consumes "Cost Optimization" and
> leaves "Cost Allocation", "Cost Transformation" and "Cost Benefit Management" for `Additional
> Skills` — which reproduces the sprawl in a different bucket. Consuming a sibling it does *not*
> contain is a claim about meaning, not spelling, and cannot be decided in `reconcileSkillGroups`.
> The grouping call has to say which skills each entry merged, which means a field on
> `emit_skill_groups` (`C4.tool` in `lib/llm/schemas.ts`) and reconciliation against that list. Pinned
> by the test *"prints a merged name that contains a selected skill, and consumes it"*.

The ATS worry that shaped the original draft turned out to be unfounded, and it is worth not
re-discovering: consolidating by **joining** rather than substituting is keyword-*denser*, not
sparser. "Corporate Governance & Regulatory Compliance (EBA)" carries three matchable terms where
"Governance" carries one. Keep the JD's words inside the compound entry and nothing is lost.

## 3. Resources or references

- `lib/pipeline/skills.ts` — `prioritiseSkills` / `reconcileSkillGroups` (there is no
  `buildSkillsSection` any more; notes written before 2026-08-23 cite it). The dedupe is a normalised
  exact-string match on `norm()` (lowercase + collapsed whitespace), which is what lets (a) through.
- `lib/__tests__/c4-skills.test.ts` — existing coverage for selection and dedupe; new naming rules
  belong here.
- `scripts/audit-c4-skills-density.ts` — read-only; prints the current Skills section for every lead
  with Keep rows. Run this first to see whether the three problems generalise beyond the one lead.
- `Process/C5. Build and Manage the Skills Section.md` — §B.4 Formatting Guidelines, §D Quality &
  Consistency Rules. The two places a rule would live.
- `Process/C1. Overall Application Content and Format Guidance.md` — check here first for the existing
  treatment the owner expects to find.
- `Process/C4. Transform Evidence into CV Bullets.md` §B.5 — "Consistency of Bracketed Tags" already
  asks for short, consistent tags across bullets; inconsistent tags are the direct upstream cause of (a).
- `Process/B2. Extract Requirements from Job Description.md` §3.6 — why the names carry JD language.
- [[C5 Skills Selection Produces Unreadable Overflow]] §2.4 — where this was logged as out of scope.

## 4. Notes / Progress log

### 2026-08-25 · Live acceptance, driven through the app

Three Generate CV runs, **clicked in the UI** at `/roleproof/leads/<id>` rather than driven from a
script — the epic's outstanding click test. All three completed clean, the .docx rendered from the
real template each time, and the C5 step report now carries the merge count.

| Lead | C5 was handed | printed | merged | ATS (baseline) |
| --- | --- | --- | --- | --- |
| ALDI `69bc2e13` | 23 | **21** · 5 categories | 5 | **88** (88) |
| Julius Baer `ee5c72bf` | 35 | **28** · 5 + Additional | 12 | **84** (82) |
| Aliaxis `a9f2307b` | 29 | **26** · 5 categories | 3 | **78** (82) |

**The stakeholder family is gone on every lead.** Julius Baer's six entries print as one —
*Senior Stakeholder Management (Board, Regulator, Multi-Entity & Six Countries)* — with every anchor
carried into the merged name rather than spent. Aliaxis's four became
*Senior Stakeholder Management (Board, Multi-Entity & Cross-Border)*; ALDI's two became
*(Cross-Entity & Board-Level)*. **What resisted** is what should: distinct capabilities that share a
word stayed apart (*Transfer Pricing* beside *Cost Allocation*, *Board-Level Strategic Advisory*
beside the stakeholder entry). No invented name reached a CV, and no `Additional Skills` bucket
appeared except Julius Baer's single unplaced entry.

**Aliaxis's ATS moved 82 → 78 and it is not the skills section.** The same lead scored 78 on
2026-08-24 and 82 earlier on 2026-08-25 with no code change between them, and the per-requirement
deltas this run are ±2–10 spread across bullet-backed requirements, not skills. C8 is an Opus
judgement over regenerated C4 bullets; this lead oscillates in a 78–82 band. Julius Baer moved the
other way, 82 → 84. Worth watching over more runs, not worth chasing here.

**The before/after counts in the table above are not the 26 / 31 / 30 in §2, and the difference is
instructive.** Those were snapshots of an older C4 run. Re-running C4 rewrites the tags, and this
time it wrote three per bullet where the snapshot had ~2.2 — Julius Baer arrived at C5 with 40
distinct tags, not 31. **The stable comparison is within a run**, handed → printed, which is what the
step report's `merged` count now records. A per-lead before/after across runs measures C4's variance
as much as C5's merging.

**One UI gap found and left alone:** once a lead has a `tailored.docx`, the workspace hides the
Generate button entirely (`{!c.cvReady && …}` in `components/roleproof/workspace.tsx`), so there is
no way to re-generate a CV from the app. These three runs needed the stored file moved aside first.
That is a real hole in the click path — out of scope here, worth its own note.


### 2026-08-25 · Built. Consolidation is declared, and the declaration is reconciled

**What shipped, in the order the section is now built.**

1. **A containment strike before the grouping call** — `absorbContainedSkills` (`lib/pipeline/skills.ts`),
   run between the language strike and the model. A selected skill that another selected skill contains
   whole is struck, and the wider name survives. This is ALDI's *Global Process Ownership & Governance*
   beside plain *Global Process Ownership*, and it needed no judgement at all. §2 assumed
   `subsumedSkills` already covered that pair; **it did not, and this is the note's one real error** —
   the guard only ever consumed atoms into a name the model COINED, and a compound that is itself in
   `selected` takes the verbatim path, where nothing was absorbing anything. Measured live: it strikes
   exactly one entry on ALDI, one on Julius Baer, none on Aliaxis. Small, but it was the case the note
   said was already handled.
2. **A declared merge** — `mergedFrom` on `emit_skill_groups` (`C5.tool`), reconciled by
   `declaredMerges` and consumed in `reconcileSkillGroups`. Exactly the seam §2 predicted: the model
   names the skills each entry replaces, and every declared source is checked back against `selected`.
3. **C5's prompt now asks for it** (§B.5 of the step note, new). That was the first job and the note was
   right that the guard was waiting rather than missing.

**The three filters on a declaration**, each dropping one source rather than the whole entry:

- **real** — the source is a selected skill, in any spelling; anything else is dropped as an invented
  name is;
- **coverage** — the merged name shares an identifying word with the source (`uncoveredSkills`), so a
  capability cannot vanish into a name with nothing of it left;
- **width** — the merged name is not contained *within* the source it absorbs.

A **coined** name additionally needs two surviving sources. One source is a rename, not a merge, and
renaming is C4's business — the register was decided upstream. That rule is what keeps a declaration
from becoming a free rewriting channel, which is the risk §2.4 flagged and did not name.

**The qualifier judgement, stated rather than left to fall out** (the handover asked for this). The
width filter *is* the answer: a merged entry must stay wider than every part it replaces, so
*(Multi-Country)* may absorb *(Multi-Entity)* — each holds a word the other lacks — but bare
*Senior Stakeholder Management* may absorb neither, because it sits inside both. **Which anchor
survives is the model's call; surviving with none of them is refused in code.** In the live runs the
model kept them all: Julius Baer's six-strong family collapsed to
*Senior Stakeholder Management (Board, Regulator & Multi-Country/Entity)*.

**Measured, C5 call only (Sonnet, no writes, three probe runs):**

| Lead | before | handed to model | printed |
| --- | --- | --- | --- |
| ALDI `69bc2e13` | 26 | 25 | **22** |
| Julius Baer `ee5c72bf` | 31 | 30 | **23** |
| Aliaxis `a9f2307b` | 30 | 30 | **26** |

Down, and down on the right families — but **not to 16–20**. Aliaxis is the honest case: it merged its
stakeholder family and its two regulatory-delivery entries and stopped, because what is left there
really is 26 different capabilities spread across 46 Keep rows. Reaching 20 on that lead means either
merging things that are not duplicates or shedding real capabilities, and the note is explicit that
shedding is the failure this CI exists to avoid. If 16–20 is to be met on every lead, the lever is
upstream — fewer bullets or fewer tags per bullet — not here.

**Deliberately left alone.**

- **`SKILLS_ENVELOPE` stays 40.** It binds on none of the three leads, and lowering it would shed.
- **The per-category size is still not enforced in code.** The §2 scope note wanted it here; the
  re-measured admonition supersedes it, and the same objection applies — a per-category cap either
  drops skills or reshuffles them into a bucket that means nothing. §B.1's 4–8 is asked for in the
  prompt and was respected on all three leads (largest category: 8).
- **CV template and page counts**, per the owner's standing instruction of 2026-08-24.

**Also fixed in passing:** the `// ── C6 · Tailored CV profile ─` header in `lib/llm/schemas.ts` had been
stranded above the C5 block by the renumber; it now sits above `C6`.

**Verification.** `npm run typecheck` clean. `npm test` 327 passing, 13 new (the 3 `capture-enrich`
failures are the missing untracked `.storage/jd-captures` fixtures in a linked worktree, not a
regression — they pass in the main tree). `scripts/snapshot-step-prompts.ts`: C5's hash moved
`c729e5d5` → `58d2db2c`, every other hash unchanged, baseline refreshed in the same commit.


### 2026-08-24 · Re-scoped to consolidation only

Two of the three original problems moved out (see the callout above). What is left is the one thing
only C4 can do. Re-prioritised to `high` and sequenced after [[C4 Writes CV-Grade Skill Tags]] on the
owner's plan: *"My hunch is, to implement: C3 Writes CV-Grade Skill Tags, Skill Name Treatment in C4,
and continue testing the other CIs."*

The §2 archaeology step is now largely done and its answer was **no pre-existing rule** — C4 §D
forbade duplication *across* categories and said nothing about duplication *within* one, which is
exactly the gap. Do not re-run that search from scratch.

### 2026-08-23 · Opened as an Idea

Split out of [[C5 Skills Selection Produces Unreadable Overflow]] at the owner's request, on seeing that
CI's verified output. His reasoning for opening it rather than accepting the names: *"it is good to have
it declared before just letting it slip by."*

The parent CI's own §2.4 recorded these three as out of scope on the grounds that they are B2 extraction
and C3 tag wording rather than C4 selection. That framing is worth re-examining as the first act of this
CI — C4 is the only step that sees the assembled set, which is the sole vantage point from which a
near-duplicate is detectable at all.

### 2026-08-26 · Click test passed — epic closed

Two leads driven end to end **by the owner, in the app**, which is the one thing no script could
supply and the reason all four notes sat at `2 - Testing`:

| Lead | Bullets | Skills | Coverage as printed | ATS |
| --- | --- | --- | --- | --- |
| `36e63a67` Anritsu · General Manager AEH | 14 | **19** | Core 11/11 · Imp 2/2 | 72 |
| `12ad67c8` Allianz Services · Senior/Principal Consultant | 14 | 25 | Core 12/13 · Imp 4/5 | 72 |

**Anritsu is the first CV inside the 16–20 skills benchmark** — 19 entries, against 21 / 28 / 26 on the
three leads that preceded the epic. Allianz Services was driven a second time specifically to exercise
Pin, which had never been touched by a person.

Verified with `scripts/verify-lead-run.ts`. Two things it reports that are **not** regressions and were
waived deliberately:

- **Allianz Services shows Core 12/13, Important 4/5.** Present on the very first C3 run, before any
  pin, and identical across all six re-solves — one requirement on that lead has no evidence that can
  cover it. Selection did not cost it.
- **A stray `Additional Skills` sixth category** appears on some leads when C5's grouping call leaves
  one skill unplaced. `reconcileSkillGroups` catches it rather than losing it, which is the intended
  behaviour of the guard. The owner's decision, 2026-08-26: live with it and remove the entry by hand
  when reading the .docx, rather than spend on it now.

Also opened rather than fixed: three display defects in `lib/selection-view.ts` — rank showing
insertion order as merit, held-back ranks starting at `budget + 1`, and the Pin label on an
already-selected card. All are in [[Select 14 Evidence Bullets by Residual Coverage]] §5. None makes a
CV wrong; all make the Map say something untrue.
