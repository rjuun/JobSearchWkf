---
ci-area: Screening (B1) / Lead lifecycle
ci-roadmap:
ci-title: Lead Liveness Re-check and Not Pursued Reason Tags
ci-status: 2 - Testing
ci-priority: high
ci-date: 2026-08-23
ci-estimated-time: 4
ci-time-spent: 2
pr-source:
pr-target: "[[B1. Capture Posting Freshness and Market Saturation]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Built 2026-08-23 — see §2.8
> Opened after the owner hit the real case: several leads he genuinely wanted to pursue closed before
> he applied. "Not Pursued" is the right bucket, but there was no way to say *why* — and marking them
> "Not Pursued" flat reads as a decision he made, when in fact the posting closed on him.
>
> §1 and §2 are kept as written, including the assessment in §2/Q1 that turned out to be **wrong** and
> the owner's push-back that corrected it. §2.8 records what actually shipped.

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
| Low Fit | `overallFitScore < 7` (B6; the scale is **0–10**, see §1.3) | no |
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

### 1.3 · A threshold conflict — settled at `< 7`

"Low Fit (less than 8)" sits on the 0–10 `overallFitScore` scale. But `recommendationFor()` in
`lib/scoring.ts` already partitions that scale:

```
>= 7   Proceed
>= 5.5 Borderline
<  5.5 (below)
```

The owner first proposed `< 8`. That would mark every lead scoring 7.0–7.9 as "low fit" while B6
recommended **Proceed** — two thresholds disagreeing about the same score. **Settled 2026-08-23 at
`< 7`**, so the tag agrees with the existing Proceed band rather than introducing a second one:
*"I will take it back and remain consistent with <7 being the Low Fit."*

## 2. What would the improvement look like?

Three parts, and they can ship independently.

**A · Make the liveness re-check real.** A control on the Results tab that genuinely re-checks the
posting and records the result, then shows the B1 re-run in the trace with its date.

**B · Capture "still accepting applications?"** The output of A that this CI exists for. Stored on the
lead — the one new fact — so "Not Pursued" can read it.

**C · Not Pursued reason tags.** Replace the single derived `NotPursuedReason` with a set:
`roadblock` / `misalignment` / `expired` / `low_fit` (`< 7`, §1.3), three derived as today and
`expired` read from B. Surfaced on the Not Pursued list, and filterable there.

### Q1 — RESOLVED: re-fetch the LinkedIn guest fragment

The owner asked for the refresh to follow the LinkedIn URL, re-run B1 and detect "No longer accepting
applications". An earlier draft of this note called that *"a real capability… closer to A1's
capture-enrichment path than to a button"* and recommended recording a manual answer instead. **That
was wrong, and the owner pushed back on it. Tested against three of his own leads, 2026-08-23:**

`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<jobId>` — no auth, HTTP 200, 20–64 KB.

| Lead | `closed-job__flavor--closed` | `posted-time-ago__text` | `num-applicants__figure` |
| --- | --- | --- | --- |
| 4418750507 | No longer accepting applications | 2 months ago | *(empty)* |
| 4439853274 | *(absent)* | 2 weeks ago | *(absent)* |
| 4407636740 | No longer accepting applications | 4 weeks ago | *(empty)* |

The closure marker is **present on closed postings and absent on open ones** — exactly the
discriminator needed, and no heuristic. Three regexes do it (`closed-job__flavor--closed`,
`posted-time-ago__text`, plus `topcard__title` to confirm the right posting came back). One module,
not a capability.

Why the earlier assessment was wrong: A1's capture path is hard because the app **never fetches
anything** — content is pushed in, either pasted or POSTed to `/api/ingest` by an agent that already
rendered the page, a design forced by the CSP wall that retired the bookmarklet. Re-reading one known
URL shape server-side does not inherit any of that. `lib/llm/client.ts` holds the only `fetch()` in
the codebase today; this adds the second.

**What the re-fetch can and cannot refresh:**

- **Closure — yes, reliably.** The headline requirement.
- **`postedDays` — yes.** "2 weeks ago" / "4 weeks ago" / "2 months ago" parse to a day count. This
  matters more than it looks: see §1.4.
- **`applicantCount` — no.** Empty on closed postings, absent on the open one. **Saturation cannot be
  refreshed this way** and stays whatever it was. State that in the UI rather than implying otherwise.

**Known risks, neither a blocker:**

- LinkedIn rate-limits and blocks datacenter IPs (429/999). It worked from the owner's machine; it may
  fail from a deployed host. The refresh must degrade to today's recompute-and-report behaviour, never
  throw.
- It is an unofficial endpoint and will change eventually. Three regexes make repair cheap, but the
  parse needs to fail loudly-but-safely (record "could not read", don't write a wrong answer).

**Coverage — worth knowing before building.** Of 172 leads: **55 carry a LinkedIn `sourceUrl`** in the
canonical `/jobs/view/<id>/` form, and **117 have no `sourceUrl` at all**. So the button serves about
a third of the catalogue, and the other two thirds need the manual answer as a fallback — not as the
primary design, but it does still need to exist.

### 1.4 · Nothing in the running app writes `postedDays`

Found while scoping and arguably the bigger prize. Grep the whole app: `postedDays` and
`applicantCount` are **only ever read** — no code path in `createLead`, `/api/ingest`, capture-enrich
or any pipeline step writes either. **38 of 172 leads have them set**, all from seeding/reconciliation;
the other 134 are null, so `freshnessBand` returns "Unknown" and `shouldHold` never fires for them.

That is why §1.2's refresh is a no-op: it recomputes a band from a column nothing populates. The
LinkedIn re-fetch would become **the first thing in the running app that ever writes `postedDays`** —
which fixes B1's freshness signal generally, not just the closure case.

### Also worth deciding

- **Q2** — Does marking a lead Not Pursued when it is flagged closed auto-apply the `expired` tag
  (owner's suggestion), or does it stay an explicit choice? Auto is convenient and matches "the why
  already lives on the row"; it also means the tag can appear without anyone having said so.
- **Q3 — RESOLVED (owner, 2026-08-23): `< 7`.** Low Fit agrees with `recommendationFor`'s existing
  Proceed band rather than introducing a second, stricter threshold. His words: *"I will take it back
  and remain consistent with <7 being the Low Fit."*
- **Q4** — Should `postedDays` become a captured *date* rather than a frozen integer? With §1.4 in
  view this is less urgent — a re-fetch rewrites the integer each time — but a date would make the
  value self-ageing between refreshes. Probably its own CI.

**Explicitly out of scope:** a new lead status. "Expired" is a reason, not a status; adding one would
be exactly the status-per-reason shape commit `4f16d5e` removed. Also out of scope: closure detection
for non-LinkedIn ATS hosts. Only 6 leads carry a non-LinkedIn `jobPostLink`, each on a different host
(Workday, Eightfold, onlyfy, …) — one bespoke parser each, for one lead each. LinkedIn is where the
volume is.

### 2.8 · What was built (2026-08-23)

- **`lib/pipeline/linkedin-posting.ts`** — new. `linkedInJobId` (URL → job id), `parsePostedDays`
  ("4 weeks ago" → 28), `parsePosting` (closure marker + posted phrase + title), and
  `readLinkedInPosting` (the fetch). Parsing is split from fetching so the interesting half is
  testable; 15 tests in `lib/__tests__/linkedin-posting.test.ts`, fixtures trimmed from the real
  guest fragments.
- **Schema** — `job_leads.accepting_applications boolean` + `liveness_checked_at timestamptz`,
  `drizzle/0038_chief_sebastian_shaw.sql`, applied. Tri-state: NULL means nobody looked, and is
  **never** collapsed into "closed".
- **`refreshFreshness`** re-reads the posting when the lead has a LinkedIn URL, rewrites
  `posted_days` from what the posting says, records the liveness answer, and reports what it actually
  did. Saturation is explicitly not re-read. A block/timeout/unreadable page writes nothing and says
  so in the summary.
- **`setLeadLiveness`** — the manual fallback for leads with no URL. Same two columns.
- **Not Pursued tags** — `notPursuedReason` → `notPursuedTags`, returning a set:
  `roadblocked` / `misaligned` / `expired` / `low_fit` (`< 7`) / `not_proceeding`. The first two and
  `low_fit` are derived exactly as before; only `expired` reads the new column, and only on
  `=== false`. `not_proceeding` still means "nothing structured to say" and only ever appears alone.
- **UI** — the lead's chip row gains a liveness chip (rendered only when the answer is known — an
  "unknown" chip on every lead would be noise) and a **re-check posting** control, shown only when
  there is a LinkedIn URL to follow. The Not Pursued list's "Why" column is now a tag row, with
  `expired` toned differently: a role that closed on you is not a shortcoming you found.

**Verified against live data**, three real leads:

| Lead | `posted_days` before → after | Band | Liveness |
| --- | --- | --- | --- |
| Siemens Advanta | 3 → **28** | null → Aging | not accepting |
| frog | 30 → **60** | null → Aging (+ HOLD ≥60d) | not accepting |
| Austria Wirtschaftsservice | null → **14** | null → Fresh | still accepting |

That first column is §1.4 in practice: Siemens was captured 3 days after publication and had read as
"3 days old" ever since. The re-check is the first thing that has ever corrected it — and on `frog`
it moved the lead across the 60-day gate, which had never fired.

**Side effect worth knowing:** those three leads now carry a real liveness answer. That is not the
back-catalogue backfill the owner declined — it is three rows touched while proving the path works,
and the values are correct.

### 2.9 · Q2 — settled: explicit click, derived tag

The owner: *"lets keep the 'Not Pursued' as a explicit click."* Read together with his earlier
*"the 'Not Pursued' button would then be able to automatically capture the 'Expired' reason"*, the
split is: **the action stays a deliberate click; the tag derives once the lead is in the bucket.**
Nothing auto-files a lead as Not Pursued because its posting closed. That keeps the 2026-07-30
derive-don't-store principle and leaves the human gate exactly where it was.

### 2.10 · Not done

- **No back-catalogue backfill**, per the owner: Archive leads were all applied to, and the existing
  Not Pursued leads already show Roadblocks or Misalignments. Their `accepting_applications` stays
  NULL, which renders as no `expired` tag — correct, not a gap.
- **No UI for `setLeadLiveness` yet.** The function exists for the 117 leads with no URL; nothing
  calls it. Worth a small control on the lead page, but the owner's actual backlog is LinkedIn leads.
- **No `postedDays`-as-a-date change** (§Q4). The re-check rewrites the integer, which is enough for
  now.

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

### 2026-08-23 · Built

Q2 settled (§2.9) and the back-catalogue explicitly left alone, so the build went straight through.
See §2.8 for what shipped and the live verification.

The one thing worth carrying forward: the re-check turned out to be worth more than the closure flag
that motivated it. `posted_days` had been frozen at capture on every lead and re-read by nothing —
Siemens had been claiming "3 days old" for a month. Fixing the freshness signal generally was a side
effect of asking a much narrower question.

### 2026-08-23 · Opened as an Idea

Opened when the owner hit the case directly: leads he wanted to pursue closed before he applied, and
"Not Pursued" flat misrepresents that as his decision.

Two things were established while scoping and are the reason this is not a small change:

1. `refreshFreshnessAction` **already exists and already records the B1 re-run** — the run-trace half
   of the ask is done. But it recomputes bands from capture-frozen inputs, so it cannot detect
   anything new. See §1.2.
2. Three of the four requested tags are **already derivable** from the row; only `expired` needs new
   stored state. Keeping that split preserves the 2026-07-30 principle instead of working around it.

### 2026-08-23 · Q1 re-scoped after the owner pushed back

The first draft judged the re-fetch too heavy and recommended a manual answer. The owner disagreed —
*"I understand you comparing the work load to A1 development, but I want to believe this refresh is
actually way simpler. You can take a deeper look on the issue and revert to me"* — and he was right.
Testing the LinkedIn guest endpoint against three of his own leads settled it in minutes: unauth,
HTTP 200, and a closure marker that is present exactly when the posting is closed. §2/Q1 rewritten
with the evidence; the manual answer survives only as the fallback for the 117 leads with no URL.

Scoping it also turned up §1.4 — nothing in the running app writes `postedDays` at all — which makes
the re-fetch worth more than the closure flag alone.
