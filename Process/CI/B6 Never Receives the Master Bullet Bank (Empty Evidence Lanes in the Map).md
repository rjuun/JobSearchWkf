---
ci-area: Screening / B6 · Requirement-Evidence Map
ci-roadmap:
ci-title: B6 never receives the Master Bullet Bank — evidence lanes cannot fill
ci-status: 9 - LLM Run Required
ci-priority: high
ci-date: 2026-08-01
ci-estimated-time: 8
ci-time-spent: 3
pr-source: "[[B6. Role Fit & Investment Worthiness Score]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Start here — self-contained
> Written to be picked up in a **fresh chat with no prior context**. §1 is the defect with file-and-line
> evidence; §2 is the fix. Siblings:
> `[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]` (delivered) and
> `[[Complete Required Lists on the Remaining Strict Tool Schemas]]` (open). Read §2.4 before sequencing
> any back-catalogue re-run.

---

## 1. What is the problem or opportunity?

**B6 is required by its own procedure to map every requirement to evidence in the Master Bullet Bank. The
implementation never sends it the Bullet Bank, and its tool schema has no field to return the mapping.**

The requirement→evidence Map now shows requirements on the right (B2 fixed, 2026-08-01) but every evidence
lane on the left reads **"no evidence placed"** — on a lead where all six B steps completed successfully.
The Map's own header states *"requirements in — evidence lanes fill at B6"*.

### What the procedure demands

`Process/B6. Role Fit & Investment Worthiness Score.md` §2 (Per-Requirement Score):

> - Map the requirement to the strongest available evidence in the **Master Bullet Bank**.
> - When relevant, also reference `tbl_Education` and `tbl_Language`…
> - **Quote or reference the exact bullet text where possible.**
> - Clearly note any gap in the `Initial_Missing_Weak` column.
> - If no relevant evidence exists, mark it as **`No Match`** and state what is missing.

### What the code actually sends — `lib/pipeline/screening.ts`, B6 block

```ts
user: `JOB DESCRIPTION:\n${jd || lead.title}\n\nREQUIREMENTS:\n${requirements
  .map((q, i) => `${i + 1}. [${q.rank}] ${q.requirement}`)
  .join('\n')}\n\nFor each requirement, set "order" to its number above.`,
```

JD text plus requirement **labels only**. No bullets, no evidence, no profile. Confirmed by absence:
`bulletBank` is imported by `lib/pipeline/tailoring.ts` and `lib/queries.ts` but **never by
`lib/pipeline/screening.ts`** — the sole reference in that file is the hardcoded stamp
`bulletBankVersion: '2026-06'` written to `job_leads` *after* scoring.

### Three distinct defects

1. **The Bullet Bank is never sent.** B6 cannot follow its core instruction. `No Match` verdicts are
   therefore uninformative — the model has nothing to match against, so "no evidence exists" and "no
   evidence was supplied" are indistinguishable in the output.
2. **No schema field carries the mapping.** `B6.requirements[]` declares
   `order, requirement, score, matchStrength, keyStrengths, gaps` — nowhere to put a bullet `refCode` or
   quoted bullet text. Same class of defect as B2's missing `groupRank`: a schema that cannot express what
   its own note demands.
3. **`bulletBankVersion: '2026-06'` is a false provenance stamp** — it records that a specific Bullet Bank
   version informed the score when no bank was consulted at all.

### Why it matters beyond the empty lanes

Every fit score in the system was produced **without evidence**. Combined with the B2 defect (scores also
produced without requirements — see the sibling CI), the stored `overall_fit_score`, `score_req_alignment`,
`initial_score` and `initial_match_strength` values across all 157 leads are not trustworthy.

### Design intent this restores

Per `[[Lead Page as Pipeline Canvas (B-Phase Reorder + Requirement-Evidence Map)]]`, the Map was built
during the B phase precisely so screening produces the **initial setup for C2**:

- **B6** — initial mapping, scoped to the **Master Bullet Bank**.
- **C2** — expands scope to the **whole Career Graph** (responsibilities, STAR actions and results,
  competences, skills) and adds the human Keep/Maybe/Drop decision.

That CI deliberately deferred the evidence picker — *"Evidence picker — deferred to its own CI, once real
data is flowing through the Map"* — because the Map plus picker design was sufficient for the B phase. Real
data is now flowing through the requirement side; this CI makes the evidence side real at B6.

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope**
- Send the owner's Master Bullet Bank to B6 (§2.1)
- Add evidence-reference fields to B6's tool schema and zod (§2.2)
- Persist the mapping and render it in the Map's evidence lanes (§2.3)
- Fix `bulletBankVersion` to record what was actually used
- While in B6's schema: complete its `required` list (`summary` at root; `keyStrengths`, `gaps` on
  `requirements[]`) — the sibling CI's defect, cheaper to fix in the same pass than to touch B6 twice

**Out of scope — belongs to C2**
- Expanding evidence scope beyond the Master Bullet Bank to the whole Career Graph
- The interactive evidence picker and Keep/Maybe/Drop human decision
- Re-running the back catalogue (see §2.4 for sequencing)

### 2.1 Send the Bullet Bank

`bulletBank` is `lib/db/schema.ts:235`; `lib/queries.ts:222` already selects it ordered by `refCode`, and
`lib/pipeline/tailoring.ts:65,96` shows the established read pattern. Inject a compact, `refCode`-keyed
listing into B6's user message so the model can cite a stable identifier rather than free text.

Two things to decide and record in §4:
- **Token cost.** B6 runs on Opus. The bank may be large; if so, consider sending only fields needed for
  matching, and measure the input-token delta before/after (`[llm]` line reports `in=`).
- **Prompt caching.** The bank is identical across leads for one owner. If it goes in the *system* prompt
  it can sit behind a `cache_control` breakpoint; in the user message it cannot. `lib/prompts.ts` splits
  `cacheable` (stable) from `dynamic` — see `systemPromptFor`.

### 2.2 Schema — carry the mapping back

Add to `B6.requirements[]` (in `lib/llm/schemas.ts`), mirrored in the zod schema:
- an evidence reference — the bullet's `refCode`, ideally an array (a requirement is often supported by
  more than one bullet; that many-to-many relationship is the Map's whole point)
- optionally the quoted bullet text, per the note's *"quote or reference the exact bullet text"*

**Every property must appear in `required`.** Under `strict: true` an incomplete `required` list degrades
the constrained grammar and collapses generation — this was measured on B2 at 0/17 before and 13/14 after.
`required` means "the key is present", not "the value is non-empty", so an empty array or `""` is fine.
Full mechanism in the sibling CI.

### 2.3 Persist and render

- `job_requirements` already carries `initial_key_strengths` and `initial_missing_weak` (unused by the
  current write path — `screening.ts` writes only `initialScore` and `initialMatchStrength`). Check whether
  these are the right home for the note's `Initial_Missing_Weak`, or whether evidence links need their own
  table given the many-to-many shape.
- The Map takes `evidence: MapEvidence[]` with `e.requirementId` and `e.slot`
  (`components/roleproof/pipeline-map.tsx:94-119`). Trace what populates that prop in
  `app/roleproof/leads/[id]/page.tsx` and wire the B6 mapping into it.

### 2.4 Sequencing — read before re-running anything

**Do not re-run the back catalogue until both this CI and
`[[Complete Required Lists on the Remaining Strict Tool Schemas]]` have landed.** A re-run today would push
157 leads through a B6 that still has no evidence, producing a second generation of untrustworthy scores
and requiring a third pass.

### 2.5 Acceptance criteria

- [ ] B6's user message contains the Master Bullet Bank; verified by the `in=` token count rising on the
      `[llm]` line
- [ ] B6 returns evidence references for requirements it can support, and `No Match` **with a stated
      reason** where it genuinely cannot
- [ ] Evidence lanes populate in the Map for a screened lead — the defect that opened this CI
- [ ] `bulletBankVersion` reflects the bank actually sent, not a hardcoded literal
- [ ] B6's `required` list complete; before/after measured per the sibling CI's protocol (4–5 runs each
      side — this failure mode is probabilistic)
- [ ] Re-score one lead and sanity-check the movement against a human reading
- [ ] `npx tsc --noEmit` clean; `npx vitest run` passing; mock mode (`mockRoleFit`) still satisfies the
      widened schema

---

## 3. Resources & references

- **Design intent:** `[[Lead Page as Pipeline Canvas (B-Phase Reorder + Requirement-Evidence Map)]]` §2.4,
  §2.5 — why the Map lives in the B phase and what was deliberately deferred.
- **Procedure:** `Process/B6. Role Fit & Investment Worthiness Score.md` §2, §3 (weights Core 3 /
  Important 2 / Nice-to-Have 1; the arithmetic is done in code, not by the LLM — `lib/scoring.ts`).
- **Code:** `lib/pipeline/screening.ts` (B6 block) · `lib/llm/schemas.ts` (`B6`) ·
  `lib/db/schema.ts:235` (`bulletBank`), `job_requirements` · `lib/queries.ts:222` ·
  `lib/pipeline/tailoring.ts:65,96` (read pattern) · `components/roleproof/pipeline-map.tsx` ·
  `lib/prompts.ts` (`systemPromptFor`, cacheable/dynamic split).
- **Observability:** `llm_calls.stop_reason` + the `[llm]` stdout line (migration `0030`). Grep `[llm]`
  while `npm run dev` runs.
- **Environment:** `lib/prompts.ts` `noteCache` never invalidates — **restart the dev server after editing
  any `Process/*.md` note**. `next lint` is broken (pre-existing); verify with `tsc` + `vitest`.

---

## 4. Notes / Progress log

### 2026-08-01 · Opened

Found while verifying the B2 fix. Reggie spotted that the Map showed requirements but no evidence, and
corrected an incorrect reading that the empty lanes were the fit gate holding C2 back. They are not: the
Map header says evidence fills at **B6**, B6 ran successfully, and the lanes were still empty.

Verified before opening: B6's user message carries only JD text and requirement labels; `screening.ts`
never reads `bulletBank`; `B6.requirements[]` has no field for an evidence reference; `bulletBankVersion`
is a hardcoded literal.

Nothing implemented yet.

### 2026-08-01 · Implemented — §2.1 · §2.2 · §2.3 and the provenance stamp

Branch `claude/b6-master-bullet-bank-lanes`. All three defects in §1 are closed.

**§2.1 · the bank is sent.** `gatherB6Evidence` (`lib/pipeline/screening.ts`) loads `bullet_bank` ordered
by `refCode`, plus `education` and `languages` — the two tables B6's own §B.1.2 names ("when relevant, also
reference `tbl_Education` and `tbl_Language`"), and nothing beyond them. Responsibilities, STAR
actions/results, competences and skills stay out: that is C2's scope, and widening B6 to them would erase
the distinction between the initial screen and the tailoring pass.

> **The note is out of date on one point, and it matters.** §2.1 says the bank "can sit behind a
> `cache_control` breakpoint" in the *system* prompt and "in the user message it cannot." It can — C2 has
> been doing exactly that since it shipped (`lib/pipeline/tailoring.ts:179`), and `UserContentBlock` in
> `lib/llm/client.ts` carries `cache_control`. B6 now follows the C2 shape: **two user blocks**, the
> owner-wide evidence listing first with its own 1h breakpoint, the per-lead JD and requirements second as
> the varying suffix. This is strictly better than the system-prompt route — it keeps `systemPromptFor`
> owner-data-free, and the bank is byte-identical across every lead in a scoring batch, so every lead after
> the first in a batch reads it from cache.

**§2.2 · the schema carries the mapping.** `B6.requirements[]` gains `evidenceRefs` (an **array** — the
many-to-many relationship is the Map's whole subject, and a single `evidenceRef` could only ever hold the
first bullet) and `evidenceNote`. Both `required` lists are now complete: `summary` at root, and
`keyStrengths`, `gaps`, `evidenceRefs`, `evidenceNote` on `requirements[]` — the sibling CI's defect, fixed
in the same pass as §2.0 planned. `lib/__tests__/b6-evidence.test.ts` asserts the completeness
mechanically, so the next person to add a property to this schema cannot forget.

**§2.3 · persisted and rendered.** New table `requirement_evidence` (migration `0032`), **applied to the
live DB**. The §2.3 question — "the right home, or its own table?" — resolved to its own table, for two
reasons. The shape is many-to-many, which no column on `job_requirements` can express. And
`requirement_tailoring` is unusable for this even though the shape rhymes: `tailoring.length` is what
`journeyState` reads as "evidence has been mapped" and `rows.length === 0` is what the workspace reads as
"show the Map card, not the Triage card", so writing B6's machine-proposed links there would make every
screened lead claim a human triage that never happened.

`initial_key_strengths` and `initial_missing_weak` turned out to be the right home for their halves after
all — B6 already emits `keyStrengths`/`gaps`, the columns have existed since `0000`, and the write path
simply never filled them. It does now.

In the Map, B6's links and C2's rows are shown **in stage order, never merged**: B6's fill the lanes at
screening, C2's supersede them the moment tailoring runs. Merging would stack each bullet twice in its slot
and make the Keep/Maybe/Drop colours meaningless. B6's chips render neutral (`approvalStatus: 'initial'`,
which is deliberately *not* an `approval_status` value) because no human verdict exists yet, with
`evidenceNote` as the hover title.

**Provenance.** `bulletBankVersion` is derived from the rows actually sent — `null` when the owner has no
bank, `'unversioned'` when rows exist but carry no version, the versions joined when a bank is mixed. The
`'2026-06'` literal is gone.

**Two things found while in here, both fixed.**
1. B2's too-thin-extraction path deletes `job_requirements` rows but would have left `requirement_evidence`
   rows behind, stranding chips in the lanes that trace to requirement ids that no longer exist. It now
   deletes both.
2. The Map's subheader could not distinguish "B6 has not run" from "B6 ran and honestly placed nothing" —
   both read *"requirements in — evidence lanes fill at B6"*. That ambiguity is precisely the symptom that
   opened this CI. It now keys off `initialMatchStrength` and says which of the two it is.

**Citations are verified, not trusted.** `resolveEvidenceLinks` drops any ref code that is not in the
listing the model was given — an invented code is a fabricated citation, and NON_NEGOTIABLES does not
permit one through. Dropped codes are counted into the B6 `pipeline_runs` output and printed as a
`[B6] dropped …` warning rather than silently discarded.

**Files:** `lib/pipeline/screening.ts` · `lib/llm/schemas.ts` (`B6`) · `lib/db/schema.ts`
(`requirementEvidence`) · `drizzle/0032_naive_black_cat.sql` · `lib/queries.ts` (`getInitialEvidence`) ·
`app/roleproof/leads/[id]/page.tsx` · `components/roleproof/workspace.tsx` ·
`components/roleproof/pipeline-map.tsx` · `scripts/seed.ts`, `scripts/verify-key-patterns.ts`,
`scripts/verify-scoring-queue.ts` (cleanup lists) · `lib/__tests__/b6-evidence.test.ts` (new) ·
`scripts/verify-b6-evidence.ts` (new) · `scripts/measure-b6-required.ts` (new).

### 2026-08-01 · Verification — plumbing (mock, real DB)

`npx tsx scripts/verify-b6-evidence.ts` — 13/13. Runs the whole B1→B6 path in mock mode against the real
database under two throwaway owner ids with their own synthetic bank, so no real lead is touched and no
real score is overwritten; everything it creates, it deletes.

| Check | Result |
| --- | --- |
| Bank + education + languages reach the B6 call | `evidenceSent=6` |
| Evidence links persisted | 7 links across 8 requirements |
| Every link names a requirement of that lead | yes |
| Every cited ref exists in the bank | yes — no fabricated codes |
| Bullet links carry a normalized CV slot a lane can receive | yes |
| Many-to-many is real (a requirement carrying several bullets) | yes |
| `initial_missing_weak` / `initial_key_strengths` written | yes |
| `bulletBankVersion` = the bank actually sent | `9999-01`, not the old literal |
| Re-scoring replaces rather than accumulates links | 7 → 7 |
| Bankless owner: no invented links, `bulletBankVersion` null | yes |

`npx tsc --noEmit` clean · `npx vitest run` 171/171 (15 files). `next lint` still broken (pre-existing).

**Environment note for whoever picks this up:** a git worktree has no `node_modules`, `.env.local` or
`.storage`. Junction the first and third from the main checkout and copy the second, or `tsc`, `vitest`
(the `capture-enrich` fixtures) and every `scripts/*` run will fail for reasons unrelated to the change.

### 2026-08-01 · Live A/B — completing `required` is what makes the new fields work at all

`npx tsx scripts/measure-b6-required.ts 23074f44… 4` against **Vestas · Head of Corporate Strategic
Planning** (21 requirements on file, 38 bank items at version `2026-06`). Read-only: it calls B6 directly
instead of through `runScoring`, so no score, judgment or link was written by any of these nine calls.

> **Read the variant labels carefully — they are not "before this CI".** All three declare
> `evidenceRefs`/`evidenceNote`; only `required` and the presence of the bank vary. The genuine pre-CI
> schema did not declare those properties at all, and it generated fine — this very lead held 21 scored
> requirements and a 3.6 score before today. **Nothing here says the old B6 was collapsing.** What it
> measures is the change being made: what happens when you add properties to a strict schema with, and
> without, adding them to `required`.

| Variant | Bank sent | Evidence props | `required` | n | Requirements returned | With evidence | Refs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `nobank` | no | declared | pre-CI | 1 | **0/21** | 0 | 0 |
| `partial` | yes | declared | pre-CI | 4 | **0/21 · 0/21 · 0/21 · 0/21** | 0 | 0 |
| `complete` | yes | declared | complete | 4 | **21/21 · 21/21 · 21/21 · 21/21** | 21/21 every run | 62 · 78 · 72 · 64 |

**0/4 → 4/4, and not probabilistically — every run on each side landed the same way.** The sibling CI
predicted `B6.requirements[]` was "most exposed… where the collapse is total rather than a dropped optional
field", and a declared-but-not-required property reproduces B2's two failure signatures exactly: two of the
four `partial` runs returned `stop_reason=max_tokens` after burning the whole 16 000-token ceiling on
`{"relevance":6.5,…,"requirements":[],"summary":"The candidate offers strong board- and executive-level
exposure…"}` — dimensions and prose emitted, the array empty — and the other two stopped cleanly at
`tool_use` with the same empty array.

**The load-bearing lesson.** Sending the bank was necessary but, paired with an incomplete `required` list,
would have made things strictly worse than doing nothing: `partial` had all 38 bank items in front of it
across four runs and returned zero requirements, where the pre-CI B6 at least returned 21 scored ones. The
Map would have stayed empty, the score would have dropped to a default, and the cause would have read as
"Opus found no evidence" rather than "the grammar collapsed". §2.0's decision to fix `required` in the same
pass was not a convenience — it was the difference between this change working and regressing.

**Token cost (§2.1's open question), measured as total input — fresh + cache write + cache read, because
Anthropic reports `in=` net of cache and comparing raw `in=` across a cached and an uncached call would
understate the bank rather than measure it:**

| | mean total input |
| --- | --- |
| `nobank` | 6 711 tok |
| `complete` | 10 643 tok |

**+3 932 input tokens, ≈ +59%.** That satisfies the first acceptance criterion and settles the concern:
the bank is ~4k tokens, not a problem at B6's volume, and the 1h breakpoint means only the first lead in a
scoring batch pays for it — runs 2–4 of `complete` show `cache[w=0 r=8691]`, the whole prefix served from
cache. (Output tokens are not comparable across these variants — `nobank`'s 160-token mean is the collapse,
not a baseline. The real output figure is the live re-score below: **5 500-ish tokens**, which is what it
costs for B6 to actually answer the question its note has always asked.)

**One criterion this lead could not exercise:** §2.5 asks for `No Match` **with a stated reason**. Across
all four `complete` runs Opus returned zero `No Match` verdicts on this posting — with 38 bank items in
front of it, it found at least one supporting bullet for all 21 requirements. The branch is covered
instead by `verify-b6-evidence.ts`'s bankless-owner case (no links invented, `bulletBankVersion` null) and
by the schema's `gaps` description, which makes the reason mandatory prose on `No Match`. Worth
re-checking on a lead with a genuine hard gap — an SAP or CFA posting.

### 2026-08-01 · Live re-score — Vestas, §2.5's last criterion

`npx tsx scripts/rescore-lead.ts 23074f44… --apply` (one Sonnet call for B5, one Opus call for B6:
`in=1952 out=5389 cache[w=0 r=8691]`).

| | Before | After |
| --- | --- | --- |
| `overall_fit_score` | 3.6 · Not recommended | **7.0 · Proceed** |
| `score_req_alignment` | 5.2 | **7.0** |
| Evidence links | **0** | **62**, across all 21 requirements |
| `initial_key_strengths` | 0/21 | **21/21** |
| `initial_missing_weak` | 0/21 | **21/21** |
| `No Match` | 2, none with a reason | 0 |
| `bullet_bank_version` | `2026-06` (hardcoded literal) | `2026-06` (read off the bank) |

The stamp reads the same and now means something: it is the version on the 29 bank rows actually sent,
not a constant.

**Is the movement defensible?** The 3.6 was produced with no evidence in front of the model, so it was
never a judgment about this candidate — it was a judgment about a JD read against nothing. The 7.0 comes
with 62 citations and a specific, checkable gap per requirement. A sample, which is what §2.5's "sanity-
check against a human reading" actually means:

| # | Rank | Score | Refs | Stated gap |
| --- | --- | --- | --- | --- |
| 7 | Core | 10 Excellent | `EDU-1`, `EDU-2` | None. |
| 6 | Core | 9 Excellent | `G2 G3 G5 S1 C7` | None; directing executive-level decisions strongly evidenced. |
| 2 | Core | 5 Good | `G1`, `P1` | *"No evidence of owning a recurring ANNUAL global strategic planning cycle… experience is programme/transformation-shaped."* |
| 11 | Important | 4 Weak | `S3 S4 EDU-4` | *"No wind/energy/utilities or capital-goods industry knowledge; industry experience is banking, not the target sector."* |
| 17 | Important | 5 Good | `G2`, `G11` | *"No explicit evidence of owning agendas for executive strategy offsites or an annual Board Strategy Seminar."* |

That reads as a fair assessment: strong on seniority, stakeholder and finance depth; genuinely weak on
sector knowledge and on the specific *annual corporate strategy cycle* the role is built around. Note
requirement 11 also demonstrates the education/language tables earning their place — `EDU-4` (IMD,
Leading Sustainable Business Transformation) is the only thing in the graph that touches the energy
transition, and B6 found it. Requirement 20 cites `LANG-1`/`LANG-3` for cultural affinity.

**The back-catalogue consequence stands, and grows.** The sibling CI recorded that every stored score was
computed without requirements; this one adds that every stored score was computed without evidence. Vestas
moved 3.6 → 7.0 — from *Not recommended* to *Proceed* — on a single lead. Any promote/drop decision resting
on the other 156 should be treated as unreliable until they are re-run. §2.4's sequencing gate is now
half-open: this CI has landed, `[[Complete Required Lists on the Remaining Strict Tool Schemas]]` has not.

### 2026-08-01 · The Map — the defect that opened this CI, closed

Read off the live DOM at `/roleproof/leads/23074f44…` (dev server, demo owner), before and after the
re-score:

| | Before | After |
| --- | --- | --- |
| Evidence chips (`[data-map-ev]`) | **0** | **53** |
| Lanes reading *"no evidence placed"* | **11** | **1** |
| Lanes carrying evidence | 0 | **8** — Role Overview, Outsourcing Framework, Governance Transformation, BBAG Wind Down, Accounting Correction Layer, Transfer Pricing, BBSA Merger, Servicing Centre |
| Subheader | *"B6 scored these against the Master Bullet Bank and placed nothing…"* | *"click any requirement or evidence item to trace the link"* |

`evidenceNote` renders as the chip's hover title — e.g. on `S1`: *"…shows acting 'as a strategic sparring
partner to the Management Board', the closest analogue to an in-house strategy…"*. The trace curves work
in both directions off these chips, which is the many-to-many relationship the Map was built to show
finally carrying real data.

**Known limitation, found by this verification: 9 of the 62 links have no lane to render in.**

| Kind | Count | Why |
| --- | --- | --- |
| Education | 5 | `EDU-*` has no `cv_position` — education is not one of the 2-page CV's 11 slots |
| Language | 3 | same, `LANG-*` |
| Bullet | 1 | `O1`'s `cv_position` is `Overarching Skills`, which `normalizeCvPosition` correctly maps to null |

These citations are persisted, they informed the score, and they are visible in `requirement_evidence` —
they simply had nowhere to sit, because the Map's left column *was* only the 11 position slots. It meant
**the Map understated B6's evidence by ~15% on this lead**, and requirement 7 ("University Degree in
Relevant Field", scored 10 Excellent on `EDU-1`/`EDU-2`) showed zero evidence despite being the
best-evidenced requirement on the page. **Fixed the same day — see below.**

### 2026-08-01 · Left column becomes the CV's real sections (Reggie's call)

Reggie's read on the above: don't defer it, and while in there, point the column at the C phase. Two
changes to the Map's profile side.

**1 · Education, Executive Education and Languages are now sections with lanes.** `getCredentialSkeleton`
(`lib/queries.ts`) returns them alongside `getCvSkeleton`; the Education/Executive Education split is
`education.type`, mirroring how the real CV prints them. Their lanes are keyed on the evidence's **own ref
code** (`EDU-2`, `LANG-3`) rather than a `CV_SLOTS` label, because these rows have no `cv_position` and
never will — education is not one of the 2-page template's slots. A ref code is already the identifier B6
cites by, so placement stays the same equality check it is for positions with no sentinel vocabulary
invented; the namespaces cannot collide (`CV_SLOTS` values are prose labels).

**8 of the 9 unplaced links now render.** The one that still does not is `O1`, whose `cv_position` is
`Overarching Skills` — a bank label that is not a CV section at all. Left alone deliberately: it is a data
question (what is that bullet's real home?), not a rendering one.

**2 · Section headings, with the provenance caption demoted.** The column head is now the grey caption
*"From your career graph · from positions · cv_position → cv_heading"*, and `Professional Experience`
takes its place as a real section heading alongside Education / Executive Education / Languages. The left
column now reads in the three levels the printed CV does — section → role → lane — and the sections C2
will fill are already drawn.

### 2026-08-01 · One chip per bullet — the many-to-many the Map always claimed

Caught in the screenshot of the above, and a defect this CI itself introduced: B6 emits one row per
*(requirement, bullet)* pair, and every row was rendering as its own chip. On Vestas that was **61 chips
for 29 distinct bullets** — the "Wind Down of BBAG" lane showed 3 bullets stacked 13 deep.

`MapEvidence.requirementId` (one) is now `requirementIds` (many), and `PipelineMap` collapses rows that
share a lane, an evidence ref and an approval state into a single chip carrying every requirement it
serves. **61 → 29 chips, zero duplicates.**

This also makes true something the component's own header has claimed since it shipped — *"click an item to
see every requirement it serves"*. It never could: with one `requirementId` per row, clicking a chip lit
exactly one requirement. Clicking the Wind Down bullet now lights **5 requirements and draws 5 trace
curves**.

`approvalStatus` is part of the merge key on purpose. C2 writes one row per requirement, so two
requirements can pick the same bullet and then be triaged differently — Keep for one, Drop for the other.
Those are two statements about the same sentence and must stay two chips. B6's rows are all `initial`, so
this never blocks the merge it exists for.

Merged in the component rather than in the query: the *(requirement, bullet)* pairs **are** the mapping and
the DB should keep them: `requirement_tailoring`, the coaching queue and any future evidence picker all
need the pair. Only the reading of it collapses.

**Verified live** (dev server, Vestas lead): sections `Professional Experience · Education · Executive
Education · Languages`; 29 chips / 29 distinct across 17 of 23 lanes; one click → 5 requirements, 5 curves.
`npx tsc --noEmit` clean · `npx vitest run` 171/171 · `verify-b6-evidence.ts` 13/13.

### 2026-08-01 · Status

**§2.5 acceptance:**

- [x] B6's user message contains the Master Bullet Bank — verified by total input tokens 6 711 → 10 643
- [x] B6 returns evidence references — 62 links across 21/21 requirements, all resolving to real ref codes
- [ ] `No Match` **with a stated reason** — *not exercised*: Opus returned no `No Match` on this posting.
      The bankless-owner path is covered by `verify-b6-evidence.ts`; re-check on a lead with a hard gap.
- [x] Evidence lanes populate in the Map — 0 → 53 chips across 8 lanes
- [x] `bulletBankVersion` reflects the bank actually sent
- [x] B6's `required` list complete; before/after measured 4 runs each side (0/4 → 4/4)
- [x] Re-score one lead and sanity-check the movement — Vestas 3.6 → 7.0, gaps read as fair
- [x] `npx tsc --noEmit` clean · `npx vitest run` 171/171 · mock mode satisfies the widened schema

Left at **2 - In Progress** rather than Delivered for one remaining reason: the `No Match`-with-reason
criterion is genuinely unexercised on a real lead. The lane-less education/language evidence that was the
other reason is now fixed — see the two entries below, which post-date this checklist. Neither blocks use
of what shipped.

The one open data question: bank bullet `O1` carries `cv_position: 'Overarching Skills'`, which is not a
CV section, so its citation still has no lane. That is a question about where that bullet belongs, not
about the Map.

**Not done, deliberately:** the back-catalogue re-run. §2.4's gate still holds —
`[[Complete Required Lists on the Remaining Strict Tool Schemas]]` has not landed, and re-running 157 leads
through the remaining nine partial schemas would buy a third pass.

### 2026-08-07 · Status corrected to `9 - LLM Run Required`

`2 - In Progress` was never a canonical value and was read as "still under development," which this isn't
— every acceptance criterion but one is code-complete and plumbing-verified (see the checklist above).
`2 - Testing` doesn't fit either, per `[[++ Continuous Improvement Procedure]]`'s definition: it implies
verification is actively in progress, and this one is stalled, not in progress — nobody has run it against
a lead with a genuine hard gap yet. The one open criterion, "`No Match` with a stated reason," is blocked
purely on someone spending an Opus call against the right lead (an SAP or CFA posting, per the note above),
which is exactly what `9 - LLM Run Required` is for.

Note for whoever picks this up: this is **not** the same gate `[[Re-run Screening Across the Back
Catalogue]]` is parked on. That CI depends on this one (and on
`[[Complete Required Lists on the Remaining Strict Tool Schemas]]`) reaching `3 - Delivered` — the
dependency runs that direction, not the reverse. This CI's own remaining gap is the single-lead `No Match`
check above; it does not need the back-catalogue re-run to happen first.
