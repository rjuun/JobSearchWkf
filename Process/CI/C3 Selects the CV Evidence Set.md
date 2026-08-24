---
ci-area: CV Tailoring (C-Phase)
ci-roadmap:
ci-title: C3 Selects the CV Evidence Set
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-24
ci-estimated-time: 7
ci-time-spent: 0
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

Measured across three real leads, 2026-08-24 — every generated CV overflows two pages:

| Lead | Green rows | Bullets | Requirement coverage | Skills printed |
| --- | --- | --- | --- | --- |
| `69bc2e13` ALDI | 31 | 23 | Core 8/8 · Imp 1/1 | 27 |
| `ee5c72bf` Julius Baer | 63 | 34 | Core 13/13 · Imp 5/5 · **NtH 0/2** | 40 (capped) |
| `a9f2307b` Aliaxis | 46 | 27 | Core 11/11 · Imp 3/3 · **NtH 0/1** | 40 (capped) |

Three things fall out of that table, and together they define the whole opportunity:

**a · The excess is redundancy, not coverage.** Julius Baer spends 34 bullets covering 18 requirements
— 63 links, 1.85 requirements per bullet. Core and Important are already at 100%. There is no
coverage-versus-length trade to make here: the length is buying repetition.

**b · Nice-to-Have is at zero on both new leads.** Budget freed by cutting redundancy buys fit and ATS
score that is currently being left on the table entirely.

**c · Skills follow bullets.** 31 rows → 28 tags, 46 → 43, 63 → 55. Roughly one tag per Keep row, and
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
whole assembled map — structurally the same argument that puts consolidation in C4 rather than C3
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
render and count, if `soffice` is present; (b) a line-count proxy computed from the model C6 already
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

### 2.8 · Acceptance

- [ ] 13–16 bullets on each of the three leads, from 23 / 34 / 27.
- [ ] **Core and Important coverage stays at 100%** — the whole premise is that this is free.
- [ ] Nice-to-Have coverage rises above zero on `ee5c72bf` and `a9f2307b`.
- [ ] No degree or language appears in the Skills section (§2.4, fixed at source).
- [ ] Skills tags fall to roughly 25–30 before consolidation — the remainder is
      [[Skill Name Treatment in the C4 Skills Section]]'s to close, and this note does not claim it.
- [ ] C7's ATS rating does not regress. Baseline: **88/100 on `69bc2e13`, 2026-08-24.**
- [ ] Selection is reproducible: same inputs, same set, every run.

## 3. Resources or references

- `lib/pipeline/tailoring.ts` — `generateCv`'s green-row query; `matchStrengthToScore`;
  `evidenceNeedsCvSlot`; `templateFits`.
- `lib/pipeline/skills.ts` — the model for a pure, testable decision module.
- `lib/db/schema.ts` §471 `requirementTailoring` — the three skill columns and `approvalStatus`.
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
