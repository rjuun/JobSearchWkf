---
ci-area: Screening (B1) / Lead lifecycle
ci-roadmap:
ci-title: Lead Liveness Re-check and Not Pursued Reason Tags
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-23
ci-estimated-time:
ci-time-spent: 0
pr-source:
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Start here — this note is self-contained
> Written to be picked up in a **fresh chat with no prior context**. It records an idea, not a design.
> Opened after the owner hit the real case: several leads he genuinely wanted to pursue closed before
> he applied. "Not Pursued" is the right bucket, but there is no way to say *why* — and marking them
> "Not Pursued" flat reads as a decision he made, when in fact the posting closed on him.
>
> **Read §1.2 before scoping.** A `refreshFreshnessAction` already exists and already records a B1
> re-run — but it cannot detect anything new, for a reason that is not obvious from its name.

---

## 1. What is the problem or opportunity?

### 1.1 · "Not Pursued" cannot say why

`not_pursued` was introduced 2026-07-30 (commit `4f16d5e`) on a deliberate principle, stated in
`lib/db/schema.ts`'s `leadStatusEnum` comment:

> One terminal status, not three: the *why* already lives on the row as `roadblocks`/`misalignments`
> (both empty means "not proceeding," no structured reason). **Mirrors the Salesforce pattern of one
> closed status plus a reason, rather than a status per reason.**

The reason is *derived at read time*, never stored — `notPursuedReason()` in `lib/queries.ts`:
roadblocks non-empty → `roadblocked`; misalignments non-empty → `misaligned`; both empty →
`not_proceeding`.

That derivation cannot express the owner's actual case. "The posting closed before I applied" and "I
simply never chased it" are both `roadblocks=[]`, `misalignments=[]` — indistinguishable, and both
render as the same neutral "Not proceeding".

**And the owner wants tags, plural, not one reason.** His words: *"A job lead might not be pursued for
a number of reasons (tags): Roadblock, Misalignment, Expired, Low Fit (less than 8). They should all
be tagged."* A lead can be several of these at once, so the single-valued `NotPursuedReason` type has
to become a set.

Worth noting how little of this is new state — three of the four are already derivable from the row:

| Tag | Where it comes from | New? |
| --- | --- | --- |
| Roadblock | `roadblocks` non-empty (B3) | no |
| Misalignment | `misalignments` non-empty (B4) | no |
| Low Fit | `overallFitScore < 8` (B6; the scale is **0–10**, see §1.3) | no |
| **Expired** | nothing records it today | **yes** |

So this stays close to the 2026-07-30 discipline: keep deriving what is already on the row, and store
only the one genuinely new fact.

### 1.2 · The freshness refresh already exists — and cannot detect a closed posting

The owner's framing was that a "refresh Posting Freshness and Market Saturation" button on the
Results tab was *"considered in the past but never implemented"*. Half of that is already built, and
the half that is missing is bigger than a button.

**What exists:** `refreshFreshness()` (`lib/pipeline/screening.ts`), exposed as
`refreshFreshnessAction` (`app/actions/pipeline.ts`) and wired to a control in
`components/roleproof/scoring-queue.tsx`. It already calls
`recordRun(leadId, 'B1', …, { refreshed: true })`, so **the run-trace requirement — "the run trace
should show B1 was re-run and its re-run date" — is already satisfied on that surface.**

**What it cannot do**, and this is the crux:

```ts
const fresh = freshnessBand(lead.postedDays);
const sat   = saturationBand(lead.applicantCount);
```

Both are pure functions of values **already stored on the row and frozen at capture time**.
`postedDays` is an integer written by A1, not a date — it never advances. So re-running this returns
**the same answer forever**. It re-computes; it does not re-check. It never re-reads the posting, so
it cannot learn that the lead aged, that applicant count moved, or — the case this CI is about — that
the posting closed.

Making the refresh mean what its name implies is therefore the real work, and it forks (§2, Q1).

### 1.3 · A threshold conflict to settle

"Low Fit (less than 8)" sits on the 0–10 `overallFitScore` scale. But `recommendationFor()` in
`lib/scoring.ts` already partitions that scale:

```
>= 7   Proceed
>= 5.5 Borderline
<  5.5 (below)
```

A `< 8` Low Fit tag would mark every lead scoring 7.0–7.9 as "low fit" while B6 recommended
**Proceed**. Either the tag threshold moves to `< 7` to agree with the existing band, or the bands
move, or the tag is deliberately stricter than the recommendation and says so. Not a detail to encode
silently.

## 2. What would the improvement look like?

Three parts, and they can ship independently.

**A · Make the liveness re-check real.** A control on the Results tab that genuinely re-checks the
posting and records the result, then shows the B1 re-run in the trace with its date.

**B · Capture "still accepting applications?"** The output of A that this CI exists for. Stored on the
lead — the one new fact — so "Not Pursued" can read it.

**C · Not Pursued reason tags.** Replace the single derived `NotPursuedReason` with a set:
`roadblock` / `misalignment` / `expired` / `low_fit`, three derived as today and `expired` read from
B. Surfaced on the Not Pursued list, and filterable there.

### Q1 — the one decision that blocks A and B

**How does the app learn the posting is closed?**

- **Manual answer (recommended as v1).** The refresh asks "still accepting applications?" and records
  the owner's answer. Cheap, honest, no new capability, ships in an afternoon. It does not make
  freshness/saturation any less stale — it just stops pretending the row knows.
- **Re-fetch the posting.** Re-read `sourceUrl`/`jobPostLink` and re-derive `postedDays`,
  `applicantCount` and a closed/open signal. This is what "refresh" ought to mean, and it would make
  the existing button honest — but it is a real capability (fetching, parsing, per-ATS closure
  detection, dead-link handling), closer to A1's capture-enrichment path than to a button.

Doing the manual version first does not block the re-fetch later: the stored field is the same either
way, only its writer changes.

### Also worth deciding

- **Q2** — Does marking a lead Not Pursued when it is flagged closed auto-apply the `expired` tag
  (owner's suggestion), or does it stay an explicit choice? Auto is convenient and matches "the why
  already lives on the row"; it also means the tag can appear without anyone having said so.
- **Q3** — §1.3's threshold: `< 8`, or `< 7` to agree with `recommendationFor`?
- **Q4** — Should `postedDays` become a captured *date* rather than a frozen integer? It is the root
  reason freshness cannot move, and it would make even the manual path more useful. Possibly its own
  CI; noted here because this is where it surfaces.

**Explicitly out of scope:** a new lead status. "Expired" is a reason, not a status; adding one would
be exactly the status-per-reason shape commit `4f16d5e` removed.

## 3. Resources or references

- `lib/pipeline/screening.ts` — `refreshFreshness()`; `freshnessBand` / `saturationBand` /
  `shouldHold` live in `lib/scoring.ts`.
- `app/actions/pipeline.ts` — `refreshFreshnessAction`; `app/actions/scoring-queue.ts` —
  `markNotPursuedAction`, `setScreeningGateAction`, `GATE_STATUS`.
- `lib/queries.ts` — `notPursuedReason()`, `listNotPursuedLeads()`, the `NotPursuedReason` type that
  becomes a set.
- `lib/db/schema.ts` — `leadStatusEnum`'s comment (the 2026-07-30 principle, verbatim); `jobLeads`
  (`postedDays`, `applicantCount`, `freshnessBand`, `saturationBand`, `roadblocks`, `misalignments`,
  `overallFitScore`).
- `components/roleproof/scoring-queue.tsx` — where the refresh control lives today;
  `components/roleproof/not-pursued-list.tsx` and `app/roleproof/not-pursued/page.tsx` — the tab.
- Commit `4f16d5e` — "Add Not Pursued status: consolidate roadblocked/misaligned drops into one
  terminal bucket". The decision has **no CI note of its own**; the rationale is only in that commit
  body and the schema comment.

## 4. Notes / Progress log

### 2026-08-23 · Opened as an Idea

Opened when the owner hit the case directly: leads he wanted to pursue closed before he applied, and
"Not Pursued" flat misrepresents that as his decision.

Two things were established while scoping and are the reason this is not a small change:

1. `refreshFreshnessAction` **already exists and already records the B1 re-run** — the run-trace half
   of the ask is done. But it recomputes bands from capture-frozen inputs, so it cannot detect
   anything new. See §1.2.
2. Three of the four requested tags are **already derivable** from the row; only `expired` needs new
   stored state. Keeping that split preserves the 2026-07-30 principle instead of working around it.
