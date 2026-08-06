---
ci-title: Re-run screening across the back catalogue
ci-area: Screening / data reconciliation
ci-roadmap:
ci-status: 9 - LLM Run Required
ci-priority: high
ci-date: 2026-08-01
ci-estimated-time: 3
ci-time-spent: 0
pr-source:
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!WARNING] Do not start this CI yet
> It is **blocked** on two other CIs landing first — see §2.1. Running it early re-screens 157 leads
> through a still-degraded pipeline and produces a second generation of untrustworthy scores, requiring a
> third pass. The sequencing is the whole point of this note.

---

## 1. What is the problem or opportunity?

**Every fit score currently stored was computed without requirements and without evidence.**

Measured 2026-08-01: `job_leads` holds **157 rows**, `job_requirements` holds **0**. Not "some leads are
thin" — the requirement corpus is empty, and 155 leads sit at a status past `captured`.

Two independent defects produced this:

1. **B2 returned nothing.** Its strict tool schema had an incomplete `required` list, which degraded the
   constrained grammar and collapsed extraction to 0–1 requirements on every real JD (0/17 measured).
   Fixed and live-verified 2026-08-01 — `[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM
   Observability)]]`.
2. **B6 never receives the Master Bullet Bank.** Its user message carries only JD text and requirement
   labels, so it scores against no evidence at all, and its schema has no field to return an evidence
   mapping. Still open — `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]`.

So the affected values are: `job_leads.overall_fit_score`, `score_req_alignment`, `score_relevance`,
`score_seniority`, `score_impact`, `score_ats`, `recommendation`, plus
`job_requirements.initial_score` / `initial_match_strength` (currently no rows at all).

**Why it matters beyond tidiness:** these scores gate the pipeline. `recommendation` and the fit threshold
decide what reaches tailoring and what gets dropped. Every promote-or-drop decision taken on the old numbers
rests on a score computed against an empty requirement list. The one lead re-screened after the B2 fix moved
**6.0 → 3.6** and flipped from *Borderline* to *Below the bar*.

---

## 2. What would the improvement look like?

### 2.1 Blocked by — check before starting

| Blocker | Why |
| --- | --- |
| `[[Complete Required Lists on the Remaining Strict Tool Schemas]]` | B3/B4/B5/B6 still carry the same incomplete-`required` defect that broke B2. Re-running now bakes their degraded output into 157 leads. |
| `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]` | Until B6 gets evidence, re-scored leads are still scored against nothing. |

Both must be `3 - Delivered`. Confirm on the CI Dashboard before starting.

### 2.2 Scope

**In scope:** re-run B1–B6 across existing leads; report before/after; handle failures per lead.
**Out of scope:** the C phase (tailoring re-runs), and any change to scoring maths — this CI only
re-executes the existing pipeline against corrected code.

### 2.3 Approach

`scripts/batch-screen.ts` already exists and does most of this: it iterates leads, calls `runScreening`,
collects per-lead failures rather than aborting the batch, and prints a summary. Re-read it before writing
anything new — it may only need a filter and a dry-run flag.

Points to settle and record in §4:

- **Which leads.** All 157, or only those in an actionable status? Leads already `Not Pursued` / archived
  arguably should not be re-scored — decide explicitly rather than by default.
- **Cost.** Each lead is ~5 LLM calls, one on Opus (B6). Estimate from `llm_calls` before running: a full
  B1–B6 pass measured ~4.8k tokens on B2 alone. Consider a small pilot batch first.
- **Rate limits and duration.** B6 runs on Opus; `batch-screen.ts` is sequential by design (prompt-cache
  reuse). Expect this to take a while; run it where it can finish uninterrupted.
- **Reversibility.** Re-screening overwrites scores. Snapshot `job_leads` scoring columns and
  `job_requirements` first — the hourly Postgres backup exists
  (`[[Setup Hourly Postgres Backup on Synology]]`), but take a deliberate pre-run dump too.
- **The B2 floor throws.** After three thin attempts B2 raises, and `batch-screen.ts` records that lead as
  a failure and moves on. Expect a non-zero failure list and re-run those individually.

### 2.4 Acceptance criteria

- [ ] Both blocking CIs at `3 - Delivered`
- [ ] Pre-run snapshot taken and its location recorded in §4
- [ ] Pilot batch (5–10 leads) reviewed by hand before the full run
- [ ] Full run completed; failures listed and re-run individually
- [ ] `job_requirements` populated for every re-screened lead; spot-check `source_text` and `group_rank`
- [ ] Before/after score comparison recorded in §4 — how many leads crossed the fit threshold in either
      direction, since that is the decision-affecting number
- [ ] Leads whose recommendation changed are reviewed by a human before acting on the new value

---

## 3. Resources or references

- **Blockers:** `[[Complete Required Lists on the Remaining Strict Tool Schemas]]` ·
  `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]`
- **Origin:** `[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]` §4,
  2026-08-01 "Live verification".
- **Code:** `scripts/batch-screen.ts` · `lib/pipeline/screening.ts` (`runScreening`, `runInitialChecks`,
  `runScoring`) · `lib/scoring.ts` · `llm_calls` (has `stop_reason` since migration `0030`, so a bad batch
  is diagnosable after the fact).
- **Backup:** `[[Setup Hourly Postgres Backup on Synology]]`, `scripts/postgres-backup.sh`.

---

## 4. Notes / Progress log

### 2026-08-01 · Opened

Split out of the B2 CI. The corpus state (157 leads / 0 requirements) and the 6.0 → 3.6 movement on the
first re-screened lead are both measured, not estimated. `ci-roadmap` left blank — this is operational data
reconciliation rather than a build wave; assign one if the wave mapping later covers this kind of work.

Nothing run. **Blocked** — see §2.1.

### 2026-08-06 · Status set to `9 - LLM Run Required`

The two sequencing gates this CI was blocked on — `[[Complete Required Lists on the Remaining Strict Tool
Schemas]]` and `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]` — are both
now delivered/near-delivered. What's left is purely the live spend: re-screening 157 leads. Moved off
`0 - Idea` since this isn't an unspec'd idea anymore, and onto the new status rather than `1`/`2` since
there's no code to write or test here at all — see `[[++ Continuous Improvement Procedure]]`.
