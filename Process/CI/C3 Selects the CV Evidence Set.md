---
ci-area: CV Tailoring (C-Phase)
ci-roadmap:
ci-title: C3 Selects the CV Evidence Set
ci-status: 2 - Testing
ci-priority: high
ci-date: 2026-08-24
ci-estimated-time: 7
ci-time-spent: 5
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

Measured across three real leads, re-measured 2026-08-25,
after [[STAR Results Never Reach the Evidence Graph]] landed — every generated CV overflows two pages:

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
([[Skill Name Treatment in the C5 Skills Section]] §2.5): a step called per item cannot optimise a set.

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
      [[Skill Name Treatment in the C5 Skills Section]]'s to close, and this note does not claim it.
- [ ] C8's ATS rating does not regress. Baselines: **88/100 on `69bc2e13`** and **78/100 on
      `ee5c72bf`**, both 2026-08-24, the latter re-confirmed at 78/100 after the STAR-results CI.
- [ ] Selection is reproducible: same inputs, same set, every run.

---

## 2b. Part 2 — C3 becomes a human gate, and the Map is where it happens

> [!IMPORTANT] Opened 2026-08-26, after Part 1 was live-tested on lead `23074f44`
> Part 1 (§1–§2.8 above) shipped and works. This part changes **when** selection happens and **where
> the human sees it**, not how it is computed. `lib/pipeline/selection.ts` is untouched.
> Part 1's `ci-time-spent` does not count toward this part.

### 2b.1 · What Part 1 got wrong about the human

Part 1 computes selection inside `generateCv`, between C2's output and bullet-writing, and shows the
result afterwards as two collapsed panels in the CV card — *Show sources on every line* and *Kept but
not on this CV*, each carrying a `ShortlistToggle`.

The owner's objection, 2026-08-26:

> *"Once I approve the whole map, C3 should run and calculate which 14 bullets from all those who have
> been approved actually deliver what has been asked in the most fulfilling way. The opportunity to
> look at the Green original Bullets and use 'Pin to CV' to make some stay in the CV — for some sort
> of consistency in storytelling, or importance that the human himself has assigned to the bullet — is
> **now, not later**. Only then should the App continue to transform the original bullets (C4)."*

Two things are wrong today. **The judgement arrives too late**: by the time the panels appear, the
bullets have already been written and the CV rendered, and nothing can act on a change because
Generate is hidden once a `tailored.docx` exists. And **the interaction is backwards**: on the Vestas
lead the owner would have to click *Never* nineteen times to express a preference the algorithm should
be proposing to him.

### 2b.2 · The flow

| Phase | Trigger | What happens | Cost |
| --- | --- | --- | --- |
| 1 · Map | C2 | Evidence lanes fill; owner Keeps or declines each row | as today |
| 2 · **Select** | **Approve map** | **C3 runs alone.** Map shows a rank on every approved card and a solid outline on those that fit. Pin / Exclude re-solve on the spot | **free — pure code** |
| 3 · Write | **Generate CV** | C4–C8 over the selected set. Map then freezes as the record | as today |

**This is what makes the generate-once rule work.** Every human override now happens *before* anything
is written, so nothing ever needs regenerating — which is why the hidden Generate button stops being
a problem rather than needing a fix.

### 2b.3 · Design decisions, all settled with the owner 2026-08-26

- **Colour stays C2's language.** `EVIDENCE_TONE` (green / yellow / red / neutral) keeps meaning
  approval and nothing else. The owner: *"there is a part of the colour-code which is meant to be used
  on the C2 which is confusing"* — so selection gets its own visual language and does not borrow one.
- **Selection reads as a solid outline** around the cards that made the cut.
- **Every approved card carries a rank badge**, not only the selected ones. The owner asked for this
  explicitly: the held-back evidence is ranked 15, 16, 17… so the near-misses are visible.
- **A second, lighter line marks saturation.** The objective goes flat before the budget does — 8 of
  Julius Baer's 14 were already past the point where anything added measurable value, so below that
  point `gain` is exactly 0 and the ranks are a tie broken alphabetically by ref. The line says
  *"below here nothing adds measurable value; the order is arbitrary"*. Without it the Map would imply
  a precision the arithmetic does not have. (The alternative — hiding ranks past saturation — was
  offered and declined.)
- **Pin and Exclude re-solve immediately.** Free, so the outlines move as you click and you see what
  your pin displaced.
- **After Generate the Map freezes.** Ranks and outlines remain as the record; the controls disappear;
  click-to-cross-highlight between evidence and requirements keeps working exactly as now. The owner:
  *"it is clear to whoever sees the map what were the requirements, which evidences were found, their
  corresponding ranks, and which ones were passed on to the CV."*

### 2b.4 · Where the data comes from — no new columns

`selectEvidence` already returns everything the Map needs: `selected[]` carries `ref`, `rank`, `gain`,
`newlyCovered` and `position`; `dropped[]` carries `ref`, `gain` and a `reason` of `excluded` /
`position cap` / `outranked`. All of it is already persisted in the C3 step's `pipeline_runs.output`.

**So the Map should read the latest C3 step output rather than gaining new columns.** `shortlist_rank`
keeps its current meaning exactly — the selected rank, null when not selected — because `C4`, `C5` and
`scripts/verify-lead-run.ts` all key off `shortlist_rank != null` meaning "on the CV". Adding a second
ranking column, or widening that one to cover dropped rows, would change a value three consumers
already depend on, for a display concern.

Ranks for held-back cards are `dropped[]` ordered by `gain` descending, numbered from `budget + 1`.

### 2b.5 · Implementation checklist

1. **Move C3 out of `generateCv`** into the approve-map action. It writes `shortlist_rank` and records
   the C3 step exactly as it does today.
2. **`generateCv` starts at C4** and requires a shortlist. If none exists — a lead approved before this
   shipped — run C3 first rather than failing, so old leads keep working. **This path must exist and
   must be tested**: the owner considered deleting and re-capturing the four legacy leads instead, and
   decided against it (2026-08-26) because their Keep decisions are hand-made judgement that no amount
   of model spend regenerates. Those leads stay, so this fallback carries them.
3. **Re-running C3 — decided 2026-08-26.** Changing a Keep decision (C2's `approval_status`) after
   selection has run invalidates the shortlist: decline a selected row and the CV would carry a bullet
   whose evidence was just rejected; approve a new one and it never competed. **Any change to the green
   set re-runs C3 automatically.** C3 is free and instant, so there is no reason to track staleness as
   a state — remove the window rather than managing it. Pins survive for rows still green; a pin on a
   row since declined is dropped, because it no longer refers to anything. This is distinct from
   Pin/Exclude, which are C3's own controls and re-solve by design.
4. **`MapEvidence` gains** `rank`, `gain`, `selected` and `pin`, fed from the latest C3 step output.
5. **Map rendering**: solid outline for selected, rank badge on every approved card, the saturation
   line, and the pin / exclude controls — shown only while a shortlist exists AND no CV has been
   generated.
6. **A server action that re-solves**: re-run `selectEvidence` with the new pin set, rewrite
   `shortlist_rank`, re-record the C3 step. No model call.
7. **Remove `Kept but not on this CV`** from the CV card; keep *Show sources on every line*, which is
   the traceability proof and a different job.

### 2b.7 · Follow-up — held-back ranks must continue from the last SELECTED rank

**Opened 2026-08-26, after Part 2 landed.** `lib/selection-view.ts` §111 numbers held-back cards from
`budget + 1`, which is exactly what §2b.3 specified and is wrong whenever C3 fills fewer places than
the budget allows. Allianz reads **1…13, nothing at 14, then 15** — a gap a reader takes for a bug,
because it looks like one.

The spec assumed the selected set always reaches `B`. It does not: the per-position cap, exclusions
and a small candidate pool can all close selection early. `budget` is what was *permitted*;
`selected` is what was *taken*, and the ranking is a single sequence over the second.

**The change:** continue from the highest rank actually assigned, not from the budget.

```ts
// lib/selection-view.ts §111
let next = budget + 1;                                   // wrong when |selected| < budget
let next = Math.max(...ranked.map((r) => r.rank)) + 1;   // continue the sequence that exists
```

Take the highest assigned rank rather than `ranked.length + 1`, so the sequence stays contiguous even
if a selected rank were ever missing. Update the `rank` doc comment at §25, which states the
`budget + 1` rule.

- [ ] Allianz's Map reads 1…13, 14, 15… with no gap.
- [ ] A lead whose selection fills the budget is unchanged — Julius Baer still reads 1…14, 15…
- [ ] Pinning and excluding still renumber correctly, including when an exclusion shortens the set.
- [ ] A test pins the case: fewer selected than budget produces contiguous ranks.

### 2b.6 · Acceptance

- [ ] Approving the map produces a shortlist and **no LLM call** — compare `llm_calls` before/after.
- [ ] Every approved evidence card in the Map carries a rank; the selected ones carry a solid outline.
- [ ] The saturation line appears where `gain` first reaches 0, and is absent when nothing saturates.
- [ ] Pinning re-solves, moves the outlines, and costs no model call. What it displaced is visible.
- [ ] Expressing "leave these out" requires **no clicks at all** — the cut is proposed, not asked for.
- [ ] Generate CV runs C4–C8 only, over the shortlisted set.
- [ ] After generation the controls are gone, ranks and outlines remain, and clicking an evidence card
      still lights the requirements it serves.
- [ ] A lead approved before this shipped still generates.
## 3. Resources or references

- `lib/pipeline/tailoring.ts` — `generateCv`'s green-row query; `matchStrengthToScore`;
  `evidenceNeedsCvSlot`; `templateFits`.
- `lib/pipeline/skills.ts` — the model for a pure, testable decision module.
- `lib/db/schema.ts` §472 `requirementTailoring` — the three skill columns and `approvalStatus`.
- Build order: [[Renumber the C-Phase to Seat Evidence Selection at C3]] →
  [[STAR Results Never Reach the Evidence Graph]] → this →
  [[Skill Name Treatment in the C5 Skills Section]].

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

### 2026-08-25 · Live run, all three leads

| Lead | Bullets | Skills printed | Coverage as printed | ATS |
| --- | --- | --- | --- | --- |
| `69bc2e13` ALDI | 23 → **13** | 27 → **26** | Core 8/8 · Imp 1/1 | **88** (was 88) |
| `ee5c72bf` Julius Baer | 35 → **14** | 40 capped → **31** | Core 13/13 · Imp 5/5 · NtH 0/2 | **82** (was 78) |
| `a9f2307b` Aliaxis | 27 → **14** | 40 capped → **30** | Core 11/11 · Imp 3/3 · NtH 0/1 | **82** (no baseline) |

Every lead rendered through the real Word template. `ee5c72bf`'s four pending rows were left pending.

**§2.8, box by box.** 13–16 bullets ✓ (13/14/14). Core and Important at 100% ✓ *as printed* — see
correction 2 above for why that qualifier is load-bearing. Nice-to-Have above zero ✗ — **structurally
impossible, see correction 1**; it is a C2 recall gap and no budget can close it. No degree or language
in the Skills section ✓ — all three of `ee5c72bf`'s degree entries are gone, at source. Skills to
roughly 25–30 ✓ at 26/31/30, with the caveat below. ATS does not regress ✓ — ALDI held exactly at
88/100 and Julius Baer *rose* from 78 to 82. Reproducible ✓ — the dry run, the mock end-to-end run and
the live run independently produced byte-identical selected sets on all three leads.

**The skills prediction was wrong, and in an instructive direction.** Applying C3's shortlist to the
previous run's tags predicted 27→17 / 48→27 / 43→27. Live it came out 26 / 31 / 30. C4 rewrote its tags
against a shorter list and wrote *more distinct* tags per bullet, so the count fell much less than
selection alone implies. `ee5c72bf`'s 31 still carries five near-duplicate *Senior Stakeholder …*
variants and two *Board-Level … Advisory* ones — that is
[[Skill Name Treatment in the C5 Skills Section]]'s to close, exactly as §2.8 says, and this note does
not claim it.

**The STAR-result path, which the previous CI left unproven, is now proven live.** `4-R3` is the only
STAR result in any of the three Keep sets and C3 selected it at rank 9 — earned, since its
`impact` of 1.0 is one of the few things still discriminating past saturation. Its bullet reads
*"Renegotiated the intercompany IT services agreement … cutting annual IT cost payments by nearly 50%
from GBP 2.4 million — a saving of roughly GBP 1.2 million."* Action first, outcome after, and the
GBP 1.2 million figure exists nowhere in the row's prose: it comes from the `metric` column that
[[STAR Results Never Reach the Evidence Graph]] composed in. The genuinely actor-less case still has no
live instance and stays unit-pinned only.

**Left at `2 - Testing` on purpose.** The runs above were driven from a script calling the same
`generateCv`, not from the app. Nobody has clicked Generate CV in the UI, and the pin / exclude
controls on the Map have had no human pass at all.

### 2026-08-26 · Rescoped — Part 2 opened, status back to `1 - Development`

Part 1 was live-tested on lead `23074f44` and the owner rejected the **interaction**, not the
arithmetic. The selection is right; it happens at the wrong moment and is shown in the wrong place.
§2b carries the new scope: C3 becomes its own gate fired by **Approve map**, and the
Requirement–Evidence Map — not two collapsed panels in the CV card — is where the human sees and
adjusts it.

Status moves back per the CI Procedure's rescoping rule. **Part 1's 7 hours do not count toward Part
2**; `ci-time-spent` stays at 7 until Part 2 logs its own.

**This defers the epic.** CI-048/050/051/052 were to close together on one click test; 050 now has
open work, so the four cannot be promoted until §2b lands. Closing the epic on Part 1 and tracking
§2b as a fifth note was the alternative; the owner chose to keep it here, in the CI that built the
interface it replaces.

Two things it settles that were open elsewhere:

- **The hidden Generate button stops being a defect to fix.** Every human override now happens before
  anything is written, so nothing ever needs regenerating. `Process/Development/Click Test - Tailoring
  a Lead End to End.md` §D changes shape when §2b lands — the pin/exclude pass moves out of step 8
  into its own phase between Approve map and Generate.
- **"Click Never nineteen times" was the real complaint**, not that controls were missing. The
  interaction asked the human to state what the algorithm should have been proposing to him.

### 2026-08-26 · Part 2 built — C3 moved to the Approve-map gate, the Map became the surface

§2b is implemented. `lib/pipeline/selection.ts` was not touched, as §2b promised: the arithmetic is
Part 1's, unchanged. What moved is **when** it runs and **where** the human sees it.

`runEvidenceSelection` is now its own exported step in `lib/pipeline/tailoring.ts` — the same body
that used to sit inline inside `generateCv`, lifted out whole. `approveAllAction` calls it, so
approving the map produces a shortlist; `setShortlistPinAction` calls it after writing the pin, so
every pin and exclude re-solves on the spot; `mapEvidenceAction` calls it when a green set already
exists, which is §2b.5 item 3's staleness rule. `generateCv` starts at C4 and runs C3 itself only
when no shortlist exists. A `shortlistFrozen` guard (a `tailored.docx` on disk) stops any of them
rewriting the record after generation.

The Map reads the verdict out of the latest C3 step's `pipeline_runs.output` through
`lib/selection-view.ts` — a pure module with 11 unit tests, no DB import, no new column, and
`shortlist_rank` keeps its exact meaning for C4, C5 and `verify-lead-run.ts`. Selection renders as a
graphite **outline** rather than a colour, because `EVIDENCE_TONE` means approval and only approval;
`ring` was already the click-to-trace highlight, so `outline` keeps the two statements independent
and one card can carry both at once. `Kept but not on this CV` is gone from the CV card, and
`ShortlistToggle` with it — the controls live on the Map now, where they can still change something.

**Five things §2b got wrong, in descending order of how much they matter.**

**1 · "All of it is already persisted in the C3 step's `pipeline_runs.output`" was not true.** §2b.4
is the load-bearing sentence of the whole design — no new columns, feed the Map from the step report
— and the step report stored `result.dropped.slice(0, 10)`. Held-back ranks come from that list, so
on Julius Baer, with 18 dropped, eight approved cards had no rank at all. Widened to the whole list.
That is a change to the report's shape, not a new column, so the design survives — but it was not
free, and **the three already-generated leads can never get theirs back**: they are frozen, so their
truncated reports stand. Those cards render a muted `–` with a tooltip saying the ranking was not
recorded, because a blank badge in that slot reads as "prints regardless", which is what Education
and Language cards say and the one thing these are not.

**2 · The saturation line cannot be read off the rank, and §2b.3's own example is mis-attributed.**
§2b.3 says *"8 of Julius Baer's 14 were already past the point where anything added measurable
value"*. Measured live, Julius Baer is **4 of 14**; the 8 belongs to ALDI's 13 — the 2026-08-25
entry above records the three leads as 8 of 13, 4 of 14, 5 of 14, in the table's own order, and
§2b.3 picked the wrong one. The consequential half is the mechanism: **rank order is not gain
order.** The swap pass appends its result at the end of the order regardless of what that item
added, and a pin enters at the front carrying whatever gain it has. On the Allianz lead that puts a
0.3-gain item at rank 13 underneath six zeroes. So the line marks where the zeroes *start*, and
whether a given card is past saturation is decided by **that card's own gain** — which makes the
dashed count equal the step report's own "filled past saturation" number, and stops the Map calling
a swap-in worthless.

**3 · Numbering held-back cards from `budget + 1` leaves a hole whenever C3 fills fewer than `B`.**
Implemented as specified, and it is visible: on the Allianz lead C3 selected 13 against a budget of
14, so the Map reads 1…13, nothing at 14, then 15 onwards. Two defensible readings — the gap is the
unfilled budget slot, or the ranks should simply be continuous — and this is the one place the spec
produces something a reader may take for a bug. **Left as specified**; flagging rather than
relitigating.

**4 · "Pins survive for rows still green; a pin on a row since declined is dropped" needed a
mechanism, not just a rule.** Nothing declines a row through the UI any more. What actually
invalidates a pin is C2 *replacing* the evidence behind a row — the pin then points at a sentence
that has been swapped out. So `runEvidenceMapping` clears `shortlist_rank` and `shortlist_pin` on
exactly the rows it resets to `pending`, in the same update.

**5 · A map holding only Education and Language rows must not fail at the gate.** The extracted C3
threw when it selected nothing, which inside `generateCv` was the right place for it and inside
`approveAllAction` would have failed an approval that had already been committed. Selecting nothing
is now reported by the step; `generateCv` keeps the throw, with the message that says what to do.

**What was found and deliberately left alone.** The pin/exclude controls render under every approved
card, which roughly doubles the height of a populated lane. Hiding them behind hover or a click was
the alternative, and both hide the affordance the owner asked to have *there*, so density loses to
discoverability for now. Also: this note's 2026-08-25 live-run table records Aliaxis at ATS 82;
`verify-lead-run.ts` reads **78** off the stored run today, which is the figure the Part 2 handover
carried as the baseline. Not touched — it belongs to whichever run wrote it.

**§2b.6, box by box.** Approving produces a shortlist with no LLM call ✓ — `llm_calls` sat at **437
before and 437 after** approving, after a pin and after an exclude; the C3 runs record
`model: code`. Every approved card carries a rank and the selected ones a solid outline ✓. The saturation line
appears where `gain` first reaches 0 and is absent when nothing saturates ✓ — Julius Baer draws it
at rank 11 over 4 dashed cards, Allianz at rank 7 over 6. Pinning re-solves, moves the outlines and
costs no model call ✓ — pinning `P3` took it to rank 1 and pushed the saturation point from 11 to
12; excluding `S1` dropped it from rank 3 to rank 32 and the set re-solved around it. "Leave these
out" takes no clicks ✓ — the cut is proposed. Generate runs C4–C8 only ✓ — measured on a clone
carrying a shortlist: `C4 → C5 → C6 → C7 → C8`, no C3. After generation the controls are gone, ranks
and outlines remain, and clicking a card still lights its requirements ✓. **A lead approved before
this shipped still generates ✓** — a clone of `b7e91408`, the one real lead with green rows and no
C3 run anywhere in its trace, ran `C3 → C4 → C5 → C6 → C7 → C8` and rendered through the real Word
template.

**How it was verified without spending anything.** Two throwaway clones — one reset to `pending` to
drive the approve → pin → exclude → generate path in the browser, one preserving the legacy
no-shortlist state — both generated in mock mode, then deleted along with their rows, runs, storage
and event records. `llm_calls` is back at 437 and the four real leads are untouched. `npm test` 340
passing (330 + 10 new), typecheck clean, and `scripts/snapshot-step-prompts.ts` still reproduces
`_step-prompt-baseline.txt` byte for byte. `verify-lead-run.ts` re-run on all three real leads: ALDI
88 and Aliaxis 78 pass every criterion, Julius Baer 84 fails the same two it failed before (6
categories, one stray `Additional Skills`) — the pre-existing state, unchanged.

**Time.** Part 2 took 5 hours and `ci-time-spent` now carries that figure alone; Part 1's 7 are
recorded in the 2026-08-25 entries above and, per the 2026-08-26 rescope, do not count toward it.

**Still open, and it is the only thing open.** Nobody has driven this with a hand on the mouse, and
no CV has been generated live since it landed. `Process/Development/Click Test - Tailoring a Lead
End to End.md` is updated for the new shape — the pin/exclude pass is now §D, its own phase between
Approve map and Generate, and Tailor moved to §E — so the epic's click test is ready to run. Status
`2 - Testing` until it has been.
