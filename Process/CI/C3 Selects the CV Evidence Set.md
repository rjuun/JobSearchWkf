---
ci-area: CV Tailoring (C-Phase)
ci-roadmap:
ci-title: C3 Selects the CV Evidence Set
ci-status: 2 - Testing
ci-priority: high
ci-date: 2026-08-24
ci-estimated-time: 7
ci-time-spent: 6
pr-source: "[[C3 Writes CV-Grade Skill Tags]]"
pr-target: "[[C3. Select the CV Evidence Set]], [[C2. Map JD Requirements to Supporting Evidence]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Depends on two notes landing first
> [[Renumber the C-Phase to Seat Evidence Selection at C3]] creates this step's number and its note
> stub. [[STAR Results Never Reach the Evidence Graph]] changes the candidate pool this step selects
> from — tuning a budget against a pool about to gain 22 quantified outcomes is tuning against inputs
> about to change.

---

## 1. What is the problem or opportunity?

**No step in the C-phase ever chooses a set.** C2 proposes every honest requirement→evidence link, the
owner approves rows one at a time in the Map, and everything approved prints. Section sizes therefore
track how much evidence was approved, not what a two-page CV can hold.

Measured across three real leads, re-measured 2026-08-25 after [[STAR Results Never Reach the Evidence
Graph]] landed — every generated CV overflows two pages:

| Lead | Green rows | Bullets | Requirement coverage | Skills printed |
| --- | --- | --- | --- | --- |
| `69bc2e13` ALDI | 31 | 23 | Core 8/8 · Imp 1/1 | 27 |
| `ee5c72bf` Julius Baer | 64 | 35 | Core 13/13 · Imp 5/5 · **NtH 0/2** | 40 (capped, 59 tags arrived) |
| `a9f2307b` Aliaxis | 46 | 27 | Core 11/11 · Imp 3/3 · **NtH 0/1** | 40 (capped, 43 tags arrived) |

Three things fall out of that table, and together they define the whole opportunity:

**a · The excess is redundancy, not coverage.** Julius Baer spends 35 bullets covering 18 requirements
— 64 links, 1.83 requirements per bullet. Core and Important are already at 100%. There is no
coverage-versus-length trade to make here: the length is buying repetition.

**b · Nice-to-Have is at zero on both new leads.** Budget freed by cutting redundancy buys fit and ATS
score that is currently being left on the table entirely.

**c · Skills follow bullets.** 31 rows → 28 tags, 46 → 43, 64 → 59. Roughly one tag per Keep row, and
nothing between C2 and the CV asks what a Skills section should hold. `SKILLS_ENVELOPE = 40` is not a
considered number — it is C4 §B.1's ceiling (5 categories × 8) multiplied out, and it is the only
thing standing between the reader and 55 entries.

The owner's framing, 2026-08-24: *"we must find a way to, right from the start, find/select the
evidences that represents the sweetspot / maximizes Fit and ATS Scores by representing the most
impactful bullets which fullfils the higher amount of core, important and nice-to-have requirements."*

## 2. What would the improvement look like?

### 2.1 · Why this is a new step and not a change to C2

C2's job is **recall**: find every genuine link. You cannot select from what was never found, and a
stingier C2 loses options permanently and invisibly. Selection is a **set** decision that needs the
whole assembled map — structurally the same argument that puts consolidation in C5 rather than C4
([[Skill Name Treatment in the C4 Skills Section]] §2.5): a step called per item cannot optimise a set.

So C2 stays generous and unchanged, and the new step reads the assembled, human-approved map.

### 2.2 · It proposes; the owner still decides

The Keep gate is a human judgement about truthfulness and is not being automated away. This step
**pre-selects** and the owner overrides — same relationship the C2 merge rules already protect
(*"silence is not a verdict"*). It writes a rank, not an approval.

### 2.3 · The objective

Items are **distinct evidence refs** — one ref becomes one bullet, which is why `green rows` and
`bullets` differ by a third in the table above.

```
V(S) = Σ_q  w(q) × max{ s(q,e) : e ∈ S, e links q }     coverage, quality-weighted
     + α × |distinct requirement_skills covered by S|    ATS keyword breadth
     + β × Σ_{e∈S} impact(e)                             quantified-outcome bonus

  w(q)   = 3 Core | 2 Important | 1 Nice-to-Have
  s(q,e) = 1.0 Excellent | 0.85 Very Strong | 0.7 Good | 0.4 Weak
           (the same ordinal `matchStrengthToScore` already defines)

  maximise V(S)  subject to  |S| ≤ B  and the §2.4 shape constraints
```

**The `max` is the mechanism.** A second bullet on a requirement already covered at Excellent adds
almost nothing, so redundancy stops paying and breadth wins without any explicit anti-duplication
rule. That is also what makes V submodular, which is what makes it cheap to solve.

`impact(e)` rewards evidence carrying a measurable outcome — the reason
[[STAR Results Never Reach the Evidence Graph]] must land first.

### 2.4 · Constraints that make it a CV and not a score

Cardinality alone will happily put nine bullets on one role and none on the next.

- **Per-position cap** (≈4) and a floor of ≥1 on the most recent two or three roles.
- **Education and Language refs are excluded from the bullet budget entirely.** They render from the
  profile tables regardless (`evidenceNeedsCvSlot`), so they were never competing for CV space.
  **This also fixes, at source, the defect where degrees printed as skills** — Julius Baer's
  *Business Administration (Degree)*, *Economic Development (Master's)* and *Quantitative Asset & Risk
  Management (Postgraduate)* all traced to `EDU-1/2/3` Keep rows. If C3 never selects them, C4 never
  writes tags for them and C5 cannot print them. No downstream filter needed.
- **`B` is a parameter, not a constant.** Default 14, from the owner's 13–16 estimate. See §2.6.

### 2.5 · Why greedy, and why no model call

V is submodular under a cardinality constraint, so plain greedy is provably within `1 − 1/e` (≈63%) of
optimal. At the real sizes here — n ≈ 34 candidate refs, B ≈ 14 — greedy plus pairwise swap local
search is effectively exact and runs in milliseconds.

It is also **deterministic and explainable**: the step can show why each bullet was chosen and what it
displaced, which a model call cannot. This follows the house rule stated at the head of
`lib/pipeline/tailoring.ts` — the LLM emits judgments, code decides. Selection is arithmetic over
judgments C2 already made.

### 2.6 · The budget is provisional, and must not pretend otherwise

The owner's sequencing, 2026-08-24: CV template and output format are deliberately deferred until
bullets and skills are right. That has a direct consequence here — **a page budget calibrated against
a template that is about to change is a number nobody should trust.** `SKILLS_ENVELOPE = 40` is
exactly what that mistake looks like a month later.

So: `B` defaults to 14 and is a named, documented parameter; the step report records the resulting
bullet count and the objective value; and re-calibration happens in the format CI, without touching
the algorithm.

**Open question — how to measure the real page count.** Counting pages needs the `.docx` rendered
(LibreOffice/`soffice`), and whether that is available in this environment is unverified. Options: (a)
render and count, if `soffice` is present; (b) a line-count proxy computed from the model C7 already
builds; (c) defer measurement to the format CI entirely. Decide when the format work starts — do not
let it block this note.

### 2.7 · Implementation checklist

1. **Migration**: `requirement_tailoring.shortlist_rank int null`. Null = not selected.
2. **`lib/pipeline/selection.ts`** — pure, testable, no DB or LLM import, same reasoning as
   `lib/pipeline/skills.ts`: the interesting behaviour is the choice, and it must be provable without
   Postgres. Exports the scorer, the greedy pass, the swap pass, and the constraint checks.
3. **Wire into `generateCv`** as the new C3, ahead of bullet-writing. Old-C3 (now C4) reads
   `shortlist_rank is not null` instead of every green row.
4. **Step report**: bullets selected of candidates, objective value, per-rank coverage before and
   after, and what was displaced. This is the surface the budget is judged from.
5. **Map UI**: show the rank, and let the owner pin or exclude a row. Pinned rows enter `S` before
   greedy runs and consume budget.
6. **`Process/C3. Select the CV Evidence Set.md`** — fill in the stub the renumber CI created.
7. **Add C3 to the three enumerations that deliberately skip it** — handed forward by
   [[Renumber the C-Phase to Seat Evidence Selection at C3]], which stopped short on purpose:
   - `lib/journey.ts` §69 `TAILOR_STEPS` — currently runs `C1, C2, C4, C5, C6, C7, C8`
   - `docs/PIPELINE.md` §33–35 — the mermaid flow goes `C2 → HITL → C4`
   - `docs/PIPELINE.md` §146–153 — the step table has no C3 row

   **The gap is correct until this CI lands, and it is not an oversight to tidy up early.** These are
   what the pipeline UI renders from, and a step listed there that no run trace can ever show is the
   product claiming to do something it does not. Same reasoning as `STEP_NOTE`'s C3 gap. Add all three
   in the same commit that makes C3 actually run — never before.

### 2.8 · Acceptance

- [ ] 13–16 bullets on each of the three leads, from 23 / 34 / 27.
- [ ] **Core and Important coverage stays at 100%** — the whole premise is that this is free.
- [ ] Nice-to-Have coverage rises above zero on `ee5c72bf` and `a9f2307b`.
- [ ] No degree or language appears in the Skills section (§2.4, fixed at source).
- [ ] Skills tags fall to roughly 25–30 before consolidation — the remainder is
      [[Skill Name Treatment in the C4 Skills Section]]'s to close, and this note does not claim it.
- [ ] C8's ATS rating does not regress. Baselines: **88/100 on `69bc2e13`** and **78/100 on
      `ee5c72bf`**, both 2026-08-24, the latter re-confirmed at 78/100 after the STAR-results CI.
- [ ] Selection is reproducible: same inputs, same set, every run.

## 3. Resources or references

- `lib/pipeline/tailoring.ts` — `generateCv`'s green-row query; `matchStrengthToScore`;
  `evidenceNeedsCvSlot`; `templateFits`.
- `lib/pipeline/skills.ts` — the model for a pure, testable decision module.
- `lib/db/schema.ts` §472 `requirementTailoring` — the three skill columns and `approvalStatus`.
- Build order: [[Renumber the C-Phase to Seat Evidence Selection at C3]] →
  [[STAR Results Never Reach the Evidence Graph]] → this →
  [[Skill Name Treatment in the C4 Skills Section]].

## 4. Notes / Progress log

### 2026-08-24 · Opened

Reached by measuring why three generated CVs overflowed two pages. The first framing was "too many
skills"; the envelope turned out to be a symptom. The finding that reframed it: coverage is already
saturated, so cutting to 14 bullets costs no Core or Important coverage at all — the length is buying
repetition. That is what makes the budget affordable rather than a trade.

Recorded because it was nearly missed: **bullets are not rows.** The 63/46/31 counts are
requirement×evidence links; distinct refs are 34/27/23. Reasoning about the budget in rows would have
set it roughly a third too tight.

### 2026-08-25 · Built

The step exists and runs. `lib/pipeline/selection.ts` (pure, no DB or LLM import) holds the objective,
the greedy pass, the swap pass and the constraint checks; `generateCv` runs it as C3 ahead of
bullet-writing; C4/C5/C6/C7/C8 all read the selected set instead of every green row. Migration 0040
adds `shortlist_rank` and `shortlist_pin`. 35 new unit tests, 317 passing in total, typecheck clean.
Checklist item 7 landed in the same commit that made the step run, as it was handed forward: C3 is now
in `TAILOR_STEPS` and in both of `docs/PIPELINE.md`'s enumerations. `STEP_NOTE` still has no C3 key,
and that gap stays correct — C3 makes no model call.

`scripts/measure-cv-selection.ts` is the before/after probe. Re-measured against HEAD before building:
§1's table reproduced exactly (31/23, 64/35, 46/27 and every coverage figure), so the premise held.

**Three things §2 got wrong, in descending order of how much they matter.**

**1 · §2.8's Nice-to-Have criterion cannot be met by this step, and the reason is not the budget.**
`runEvidenceMapping` filters requirements to `CORE_AND_IMPORTANT` before anything else runs
(`tailoring.ts` §757), so **C2 never sees a Nice-to-Have requirement at all**. There are not zero
*green* rows for the three NtH requirements on `ee5c72bf` and `a9f2307b` — there are zero rows, full
stop. Selection selects from what C2 proposed and the owner approved; it cannot manufacture a link.
So §1(b)'s "budget freed by cutting redundancy buys fit and ATS score currently left on the table" is
wrong twice: the freed budget has nothing to buy, and on one of the two leads it should stay that way.
`a9f2307b`'s NtH ask is *Project/Change Management Certifications*, rated No Match — the candidate
does not hold them, and zero is the honest answer.

`ee5c72bf` is the live one. B6 **did** find evidence for both of its NtH requirements — G2/G10/G11 for
*Meeting Preparation and Coordination* (rated Very Strong, 7/10) and L1/L2/G11 for *Cultural and People
Initiatives* (Good, 5/10) — and it is sitting in `requirement_evidence` where C2 never looks. That is
a C2 recall gap, not a C3 one, and widening C2's intake changes its prompt, its cost per run and every
lead's map. It needs its own note. **Left alone deliberately**; this CI does not touch C2, per §2.1.

**2 · §2.8's "Core and Important coverage stays at 100%" collides with §2.4's own exclusion rule.**
Three Core requirements across two leads are covered *only* by Education or Language evidence:
`69bc2e13`'s *Business-Fluent English* (LANG-2), `ee5c72bf`'s *University Degree in Business
Administration* (EDU-1/2/3) and *Fluency in English and German* (LANG-2/3). §2.4 keeps Education and
Language out of the bullet budget, so measured over selected rows alone, coverage necessarily falls to
Core 7/8 and Core 11/13 the moment C3 runs — the criterion fails by construction, for obeying the
constraint two paragraphs above it.

It is a measurement question, not a design fault: those requirements *are* answered on the printed CV,
by the Education and Languages sections, which render from the profile tables regardless. So the step
report carries both readings and names the difference — `afterBulletsOnly` and `afterAsPrinted`. **As
printed, Core and Important hold at 100% on all three leads.**

**3 · The objective goes flat long before the budget does, and §2.3's α term cannot help.**
100% Core+Important coverage is reached in **4 bullets on `69bc2e13`, 5 on `ee5c72bf`, 6 on
`a9f2307b`** — §1's "coverage is saturated" is if anything understated. Past that point every
remaining candidate has a marginal gain of exactly zero. The ATS term cannot break the tie either:
`requirement_skills` is B2's ask on the *requirement*, so once a requirement is covered, every further
bullet linking it contributes skills already counted. α is therefore a function of which requirements
are covered — which is what the coverage term already measures. It discriminates between sets covering
*different* requirements and is silent between sets covering the same ones.

So with B = 14 and V maxed at ~6, the back half of every CV is decided by the tie-break. Left implicit
that is alphabetical order of the ref code, which is not a reason to put a bullet on a CV. The
objective ships exactly as §2.3 argues it — but the tie-break is now explicit and principled: at equal
marginal gain, prefer the candidate worth more *on its own*, `V({c})`, the same objective over the
singleton. No new term, no new constant, and V is unchanged wherever it discriminates at all. The step
report says how many bullets were filled past saturation (8 of 13, 4 of 14, 5 of 14). **§2.6 asked for
the budget to stay judged rather than inherited; this is the number that judges it.**

**Smaller corrections.** §2.8's "from 23 / 34 / 27" mixes the bullet counts with the older distinct-ref
counts — measured, the leads run 23 / 35 / 27 in the table's own order. §2.3 calls `s(q,e)`'s values
"the same ordinal `matchStrengthToScore` already defines"; the ORDER is the same, the values are not
(that function returns 9 / 7.5 / 5.5 / 3 / 1 on a 0–10 scale). Both are stated in `matchQuality`, and a
test pins the orderings together so they cannot drift apart silently. §2.3 also omits `No Match` and a
null label; both occur in stored rows and are handled explicitly.

**What was found and deliberately left alone.** `bullets14` in C7 mapped over Keep *rows* and sliced to
14 — so a lead whose bullets each answer several requirements sent the same line to the .docx and to C8
three to seven times over, and the "14" was a raw cap on rows, not a content budget. Fixed here rather
than left, because C3 makes it trivially correct (one bullet per selected ref, nothing to truncate).
`provenanceCoverage` had the same row-vs-ref confusion and was telling the owner his CV had 64 traced
lines when the document held 35; also fixed, since the Map's proof trail is the one surface whose whole
job is not to overclaim. Neither is in §2.7.

**Verified end to end without spending anything**: the full C3→C8 chain was run in mock mode against
throwaway clones of all three leads (cloned, generated, asserted, deleted). Bullets 23→13, 35→14,
27→14; the real Word template renders on all three; no Education or Language row is ever ranked; no
unselected row keeps a stale `cv_bullet` or `cv_bullet_skills`. Applying C3's shortlist to the tags the
last *live* C4 run actually wrote predicts skills of **27→17, 48→27, 43→27** — and **all three of the
degree entries §2.4 named disappear from `ee5c72bf`'s Skills section**, at source, with no downstream
filter.

Still open: the live Generate CV that §2.8's ATS baselines need, and with it the epic's click test.
