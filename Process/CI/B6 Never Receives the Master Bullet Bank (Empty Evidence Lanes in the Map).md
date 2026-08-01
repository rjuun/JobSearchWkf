---
ci-area: Screening / B6 · Requirement-Evidence Map
ci-roadmap:
ci-title: B6 never receives the Master Bullet Bank — evidence lanes cannot fill
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-01
ci-estimated-time: 8
ci-time-spent: 0
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
