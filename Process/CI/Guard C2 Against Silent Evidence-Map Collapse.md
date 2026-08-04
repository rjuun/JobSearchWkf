---
ci-area: LLM tool schemas / pipeline reliability
ci-roadmap:
ci-title: Guard C2 against silent evidence-map collapse
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-04
ci-estimated-time: 4
ci-time-spent: 0
pr-source: "[[Complete Required Lists on the Remaining Strict Tool Schemas]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Start here — this note is self-contained
> Written to be picked up in a **fresh chat with no prior context**. The defect, the measured proof, the
> exact floor to implement, the two working precedents to copy, the prerequisite that blocks measurement,
> and the budget constraint are all below. Read §1 and §2 before touching code.
>
> **Do the prerequisite in §2.3 first.** The harness cannot currently measure the thing this CI is about,
> so building the guard before fixing the harness means shipping an unvalidated floor — which is worse
> than the current behaviour, because a false-positive floor blocks tailoring on healthy leads.

---

## 1. What is the problem or opportunity?

**C2 — the step that maps every Core/Important requirement to its supporting evidence — degrades roughly
1 call in 12, returning a near-empty map that is schema-valid, logged `ok`, and written to the database
without complaint.**

C2 is upstream of the entire tailoring phase. Its `requirement_tailoring` rows are what the human
approves, what C3 rewrites into CV bullets, what C4 mines for the skills section, what C5 turns into the
profile, and what C7 rates. A collapsed C2 does not produce a *wrong* CV so much as a **thin** one built
from one or two pieces of evidence, with no error anywhere in the trace.

### The mechanism

Two separate things had to be true for this to survive. The first is now fixed; the second is not.

1. **Incomplete `required` list** — fixed by `[[Complete Required Lists on the Remaining Strict Tool Schemas]]`.
   Under `strict: true` the model's output is grammar-constrained, and a `required` list that omits declared
   properties degrades that grammar rather than making the fields optional. C2's `links[]` declared five
   properties and required three; the two omitted (`connection`, `cvPosition`) were exactly the two that
   misbehaved. Completing the list took collapses from 3-in-12 to 1-in-12.

2. **Nothing rejects a near-empty result** — still open, and this CI. `C2.zod` declares
   `links: z.array(...).default([])` and `gaps: z.array(...).default([])`. Neither has a floor, so a reply
   containing one link and zero gaps is perfectly valid. `runStructured` logs `status='ok'`, `attempts=1`,
   and its bounded zod retry never fires because there is nothing for zod to reject.

**A complete `required` list guarantees the KEY is present. It can never guarantee the VALUE is
meaningful.** That is the lesson the B6 CI learned the hard way — B6's lists were already complete when it
was found emitting `"summary":"placeholder"` — and it is exactly what the C2 measurement below reproduced.

### The proof (measured 2026-08-03, 12 live Opus runs, three real leads)

Read-only A/B via `scripts/backtest-notes.ts`, both arms on a byte-identical C2 note, so all twelve runs
sample the same (already fixed) schema. Raw data in `scripts/data/schema-ci/`.

| | old schema (12 runs) | complete `required` lists (12 runs) |
| --- | --- | --- |
| collapsed runs (coverage < 50%) | 3 | **1** |
| mean links | 8.7 / 10.7 | 16 / 14.3 |
| mean coverage | 63.5% / 79% | 85.7% / 72.2% |

The surviving collapse, in full — 108 output tokens against a lead with **15** Core/Important requirements:

```json
{"links":[{"order":4,"evidenceRef":"C7","matchStrength":"Very Strong","connection":"placeholder","cvPosition":""}],"gaps":[]}
```

Note `"connection":"placeholder"` and `"gaps":[]`. The model did not say it could not evidence the other
fourteen requirements; it simply stopped. A healthy run on the same lead returns 14–15 links and ~2,000
output tokens. A second, otherwise-healthy 21-link run also emitted one `"connection":"placeholder"` row —
so the degradation is not strictly all-or-nothing.

### Why this matters now

The owner is tailoring CVs against real job leads under the current code. Today the only thing standing
between a collapsed C2 and a thin CV is **a human noticing the link count is short before approving rows**.
That works — the step summary reads `N links · M gaps · pending review` and the Map visibly has few rows —
but it is a manual check on every lead, forever, and it is the only one.

Downstream is in better shape than it was: C3 now refuses to write rather than silently substituting raw
evidence text for a tailored bullet (same CI as above). But C3's floor cannot help here — given one link,
C3 faithfully rewrites that one link and reports success.

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:** a count-and-re-ask floor on C2 in `runEvidenceMapping`, matching the two guards already in
the codebase; the harness change in §2.3 that makes the floor measurable; unit tests for the floor
predicate; a before/after measurement; this note's §4 updated with the result.

**Out of scope — each its own CI:**
- **A C5 floor.** `C5.zod` is `z.object({ profile: z.string() })` and an empty string passes, so a degraded
  C5 produces a CV with a blank profile section. Real, unguarded, and a different step. Visible in the C5
  step summary (word count collapses to `1`) and in the rendered .docx.
- **Measuring the other eight schemas** whose `required` lists were completed but never behaviourally
  verified (A1, B3, B4, B5, C3, C7, IMPORT, COACH_DRAFT). Cost-gated, not risk-gated.
- **Re-running the back catalogue.** Sequencing still applies — do not re-run tailoring across stored leads
  until this guard is live, or you manufacture a second generation of thin maps.

### 2.1 The floor to implement — and why it is NOT B6's

This is the one design decision that matters, and it is the reason this could not simply be copied from
the C3 work in the parent CI.

| Step | Floor | Why |
| --- | --- | --- |
| B2 | proportional (`tooThin`: ≥4 requirements past 600 chars of JD) | a short vacancy blurb can genuinely have one real demand |
| B6 | **exact** — every requirement judged | B6 is handed a finite list and told to judge every row; there is no legitimate abstention |
| C3 | **exact** — one bullet per ref-bearing Keep row | same; recording a gap is C2's job, not C3's |
| **C2** | **exact, but over `links ∪ gaps`** | ← this CI |

**C2 is allowed to leave a requirement unlinked.** `Process/C2` §F is explicit: where no honest match
exists, record the requirement under `gaps` rather than forcing a weak link. A floor of "every requirement
must have a link" would therefore punish the single most important truthfulness behaviour in the step.

So the floor is: **every Core/Important requirement must be accounted for by a link OR by a gap.**

```
accounted = { link.order : link ∈ links } ∪ { gap.order : gap ∈ gaps }
floor: accounted ⊇ { every requirement order sent to the model }
```

Against the measured collapse: 1 link, 0 gaps, 15 requirements → 14 unaccounted → fires. Against a healthy
run that honestly gaps five requirements → 0 unaccounted → passes.

**Two things to get right, both learned from C3's floor:**

- **A blank value is not an answer.** `connection`, `cvPosition` and `requirement` are all required in the
  strict schema now, so a degraded call returns the keys holding `""`. A gap whose `note` is empty, or a
  link whose `evidenceRef` is empty, must not count toward the floor — otherwise the guard is satisfied by
  exactly the reply it exists to reject. This is the `"connection":"placeholder"` failure wearing a hat.
- **Decide explicitly what to do about `order: 0`.** The parent CI gave `C2.gaps[].order` a **0 sentinel**
  meaning "not one of the numbered requirements" (an integer has no empty form). A gap at order 0 is real
  output but accounts for no specific requirement, so it must not satisfy the floor for any row.

### 2.2 The fix pattern — two working precedents, copy one

Both live in this repo and both were built for exactly this failure class. Read them before writing code.

**B6** — `lib/pipeline/screening.ts`, the block commented `── The collapse guard (2026-08-02) ──` (~line 636),
with the `unjudged` helper (~line 684). **C3** — `lib/pipeline/tailoring.ts`, the block commented
`── The C3 collapse guard ──`, with the exported pure helpers `absorbC3Bullets` (line 107) and
`missingC3Refs` (line 124).

The shape is identical in both:

```ts
const ATTEMPTS = 3;
const ask = async () => runStructured({ /* … */ });

let r = await ask();
absorb(r.data);                                    // fold the reply into an accumulator
for (let attempt = 2; attempt <= ATTEMPTS && stillShort(); attempt++) {
  r = await ask();
  absorb(r.data);                                  // re-asks ACCUMULATE — a partial reply keeps its rows
}
if (stillShort()) throw new Error(/* specific, actionable */);
// …only now write anything
```

Four properties to preserve:

1. **Re-ask, don't lower the bar.** `runStructured`'s own retry cannot fire — a thin reply is schema-valid.
   The loop exists at this layer for that reason.
2. **Accumulate across attempts.** A partial reply is still worth the requirements it did account for; the
   second attempt only has to cover the remainder.
3. **Throw, don't degrade.** Nothing is written on the way out. At a ~1-in-12 per-call rate, three
   independent attempts put residual failure near 1-in-1,700, so the throw is rare and honest when it fires.
4. **Extract the predicate as an exported pure function** and unit-test it — `matchB6Judgments`,
   `absorbC3Bullets` and `missingC3Refs` all do this so the interesting behaviour is provable without
   Postgres or an API key. C3's floor has 16 cases in `lib/__tests__/c3-bullet-floor.test.ts`; mirror that
   file's structure.

**Where it goes.** `lib/pipeline/tailoring.ts` → `runEvidenceMapping`, the block commented
`// C2 — map every Core/Important requirement to its strongest evidence` (~line 238). The existing write
path already builds `reqByOrder`, so the set of orders sent to the model is in hand.

> [!WARNING] Sequencing — read before starting
> An earlier draft of this note also carried a "compute in memory, validate, *then* delete+insert" item,
> because the current code deletes the previous map before knowing whether the new one is any good.
> **That item is superseded by `[[Make C2 Build on B6 Instead of Re-Deriving the Map]]`**, which removes
> the wholesale delete entirely in favour of a merge. Do that CI first. Two consequences:
>
> - **Most of this CI's urgency goes away with it.** Under a merge, a collapse is no longer destructive —
>   you keep the prior map and your approvals, you simply gain nothing that run. The floor's job drops from
>   *prevent data loss* to *report honestly whether the deep pass actually ran*. Still worth having, no
>   longer urgent.
> - **The floor's shape may change.** Once C2 is targeted at only the `Weak` / `Good` requirements, the
>   denominator is no longer "every Core/Important requirement" — it is the tiered subset actually sent.
>   Re-derive §2.1 against the post-merge code rather than assuming it carries over.

Note the existing write path (~line 264) drops links whose `order` is unknown or whose `evidenceRef` does
not resolve, and dedups by `seen`. Do the floor against the model's own claims *before* that filtering, or
a run with one fabricated citation will read as a collapse.

### 2.3 PREREQUISITE — the harness cannot currently measure this

`scripts/backtest-notes.ts` line 391:

```ts
coverage: pct(new Set(links.map((l: any) => l.order)).size, coreImp),
```

**Coverage counts unique link orders only. `gaps` is ignored entirely.** Healthy runs therefore score
59–100% purely because honest gaps are invisible to the metric, which means it *cannot distinguish a
legitimate gap from a skipped requirement* — the exact distinction this CI's floor is built on.

So before measuring anything:

1. Add an `accounted` metric to the harness: `|links.order ∪ gaps.order| / coreImportant`, applying the same
   blank-value and `order: 0` rules as the floor itself, so the harness and the guard agree by construction.
2. Keep the existing `coverage` as-is — the recorded baselines in `scripts/data/backtest-notes.md` and
   `scripts/data/schema-ci/` are expressed in it and must stay comparable.
3. **Re-render the historical runs.** `scripts/data/schema-ci/c2-required-lists.jsonl` holds the 12-run
   checkpoint from the parent CI, and `--report` re-renders from checkpoint **without spending anything**.
   If the stored rows carry enough payload to compute `accounted` retroactively, that is a free first
   answer to "does this floor false-positive on healthy runs?".

### 2.4 Measurement protocol

**The floor's failure mode is the false positive, not the false negative.** A guard that fires on a healthy
lead blocks tailoring on good work, which is worse than today's behaviour. Measure that first.

1. **Free, from checkpoint:** re-render the 12 stored runs with the new `accounted` metric (§2.3.3). Eleven
   of those twelve are healthy. If the floor would have fired on any of them, **stop and redesign** —
   probably to a proportional floor rather than an exact one.
2. **Dry run first, always:** `npx tsx scripts/backtest-notes.ts --steps C2 --runs 2` with no `--apply`
   resolves the cohort and prints the exact call count for free.
3. **Live, narrow:** `npx tsx scripts/backtest-notes.ts --apply --steps C2 --runs 2` = 12 calls, ~$1–1.50.
4. **Judge by collapse count, never mean coverage.** The variance is larger than the effect at low n — two
   runs of the same unchanged comparison flipped a verdict during the note-repoint backtest. A mean built
   from eleven good runs and one catastrophic one describes neither.
5. **Verify the guard actually engages.** The honest test is a forced one: temporarily stub the C2 reply to
   the collapsed payload from §1 and confirm it re-asks three times and then throws without writing. This
   belongs in the unit tests, not in a live run.

### 2.5 Acceptance criteria

- [ ] Harness records an `accounted` (links ∪ gaps) metric alongside the existing `coverage`
- [ ] The 12 stored runs re-rendered with it; **the floor does not fire on any of the 11 healthy runs**
- [ ] Floor predicate extracted as exported pure function(s), mirroring `missingC3Refs`
- [ ] Unit tests covering: the measured collapse payload; an honest all-gaps reply passing; blank
      `note`/`evidenceRef` not counting; `order: 0` not satisfying any row; duplicate orders counted once;
      accumulation across re-asks
- [ ] §2.1's floor re-derived against the post-merge code — the denominator is the tiered subset C2 was
      actually asked to dig on, not every Core/Important requirement (see the §2.2 warning)
- [ ] Live before/after per §2.4, results recorded in §4 with per-run numbers, not just means
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — all passing (195 at the time of writing)
- [ ] Mock mode still clears the floor — `mockEvidenceMap` already emits a gap for every requirement it
      did not link, so it *should* pass unchanged; confirm rather than assume (C3's mock had to be fixed
      for exactly this reason: it produced a blank bullet for rows with a null `originalText`)
- [ ] One live tailoring run verified in the UI

---

## 3. Resources & references

- **Parent CI:** `[[Complete Required Lists on the Remaining Strict Tool Schemas]]` — the schema fix, the
  12-run C2 measurement, and the C3 guard whose pattern this copies. Its §4 is the fullest write-up.
- **Grandparent:** `[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]` — where
  the strict-schema mechanism was first established, and the `tooThin` proportional-floor precedent.
- **Sibling:** `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]` — the
  `placeholder`-in-a-required-field discovery and the exact-floor guard this one adapts.
- **Code:** `lib/pipeline/tailoring.ts` (`runEvidenceMapping` ~238; C3's floor helpers 107/124) ·
  `lib/pipeline/screening.ts` (B2 `tooThin` ~382; B6 guard ~636, `unjudged` ~684) ·
  `lib/llm/schemas.ts` (`C2`) · `lib/llm/client.ts` (`runStructured`) · `lib/ci.ts` (`recordGapTips`).
- **Tests to mirror:** `lib/__tests__/c3-bullet-floor.test.ts` (16 cases) ·
  `lib/__tests__/b6-evidence.test.ts` (`matchB6Judgments`).
- **Data:** `scripts/data/schema-ci/c2-required-lists.jsonl` (12-run checkpoint) and
  `…-report.md` (rendered) · `scripts/data/backtest-notes.md` (note-repoint baseline — **do not
  overwrite**; the harness writes to that path by default, so move its output aside afterwards).
- **Static audit, free:** `npx tsx scripts/audit-strict-schemas.ts` — walks every `strict: true` schema and
  exits non-zero if any declared property is missing from `required`. Run it before and after; it should
  stay clean.

### 3.1 Environment notes

- **Budget: ~US$17 of Anthropic credit**, and the owner needs ~$21 to re-screen 147 leads at the weekend.
  This CI's live measurement is ~$1–1.50. Do the free checkpoint re-render (§2.4.1) before spending.
- `.env.local` lives in the repo root and is **not** copied into `.claude/worktrees/*` — the harness and any
  DB script needs it in `process.cwd()`. It is gitignored via `.env.*`; delete any copy when done.
- A fresh worktree has no `node_modules` (`npm install`) and no `.storage/` — three `capture-enrich` tests
  fail with `ENOENT` on `.storage/jd-captures/{188,180,149}/raw.md` until those are copied from the repo
  root. Gitignored fixtures, not a regression.
- `lib/prompts.ts` caches step notes in a module-level `noteCache` that never invalidates. **Editing any
  `Process/*.md` note requires a dev-server restart.** A fresh `cache[w=… r=0]` on the `[llm]` line confirms
  the system prompt bytes changed.
- `next lint` is broken in this repo (pre-existing). Verify with `npx tsc --noEmit` + `npx vitest run`.
- `scripts/verify-tailoring.ts` is **destructive** — it promotes a real lead, overwrites its tailoring rows
  and marks four green. Do not use it as a smoke test against real data.

---

## 4. Notes / Progress log

### 2026-08-04 · Opened

Split from `[[Complete Required Lists on the Remaining Strict Tool Schemas]]` per
`[[++ Continuous Improvement Procedure]]` §"Splitting large CIs", on the same reasoning that split that note
out of the B2 CI: the parent's subject is grammar degradation from incomplete `required` lists, and this is
a different defect class — a required key present and meaningless. The parent measured the residual and
recorded the recommended floor but deliberately did not build it, because the floor could not be validated
against the harness as it stands (§2.3).

Nothing implemented yet. The §1 measurement is real and reproducible from
`scripts/data/schema-ci/c2-required-lists.jsonl`; the §2.1 floor is a design proposal that **§2.4.1 must
falsify or confirm before any code is written**.

**Interim mitigation in force:** after running *Map requirements → evidence*, compare the link count in the
step summary against the lead's Core/Important requirement count before approving rows. A handful where a
dozen-plus is expected means the call collapsed — re-run the mapping rather than approving it.

### 2026-08-04 · Deprioritised behind the incrementality work

The "delete-after-validate" item was split out into
`[[Make C2 Build on B6 Instead of Re-Deriving the Map]]` and superseded there: a merge never
wholesale-deletes, so there is no ordering left to fix. That CI also removes most of the damage this one
was written to contain — under a merge a collapse costs nothing rather than destroying the map and the
user's approvals.

This note stays open and worth doing, but **after** the merge work, and §2.1 must be re-derived first: a
C2 targeted at only the `Weak` / `Good` tiers is no longer expected to account for every Core/Important
requirement, so the floor's denominator changes.
