---
ci-title: Retire the requirement_group duplicate column
ci-area: Data model / Screening
ci-roadmap: P6
ci-status: 0 - Idea
ci-priority: low
ci-date: 2026-08-01
ci-estimated-time: 2
ci-time-spent: 0
pr-source:
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

## 1. What is the problem or opportunity?

**`job_requirements.requirement_group` is written on every extraction and read by nothing.**

`lib/pipeline/screening.ts` (B2 insert) writes the same value into two columns:

```ts
rank: req.rank,
requirementGroup: req.rank,
```

`rank` is read in ~25 places. `requirement_group` is read in **zero** — a grep for `requirementGroup` /
`requirement_group` finds only the schema definition (`lib/db/schema.ts`), that write, and one more write in
`scripts/seed.ts`.

**The naming is inverted against the procedure, which is why this is worth a note rather than a silent
delete.** `Process/B2. Extract Requirements from Job Description.md` §B calls the
Core / Important / Nice-to-Have field the **Requirement Group**, and reserves **Rank** for the sequential
counter within that group. The code does the opposite: `rank` holds the group name, and the column actually
named `requirement_group` is the dead one.

So the column whose name matches the methodology is the one nobody reads, and the column that carries the
value has the wrong name. Anyone reading the schema against the note will misread it — this note exists so
the next person doesn't have to re-derive that.

Discovered while fixing
`[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]`, where the option of
repossessing `rank` was considered and **rejected** — ~25 readers including `queries.ts` filters
(`inArray(jobRequirements.rank, ['Core','Important'])`), `scoring.ts` `RANK_WEIGHT`, `tailoring.ts`,
`coaching-queue.ts`, raw SQL in `scripts/seed.ts`, and four components. The within-group counter became a
new `group_rank` column instead (migration `0031`).

Nothing is broken today. This is tidy-up, which is why it sits in P6.

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:** remove the duplicate write and the column, or rename so schema and methodology agree.
**Out of scope:** renaming `rank` itself, and any change to `group_rank` (shipped and working).

### 2.1 Decide the end state first

Two defensible options — pick one before writing code:

| Option | Change | Cost | Result |
| --- | --- | --- | --- |
| **A — Drop it** | Remove the `requirementGroup` write from `screening.ts` and `scripts/seed.ts`, drop the column | ~30 min, one migration | Schema shrinks. `rank` keeps its misleading name. |
| **B — Swap the names** | Move the group value into `requirement_group`, repoint all ~25 readers, drop `rank` (or repurpose it for `group_rank`) | Hours, touches queries / scoring / tailoring / coaching / UI / raw SQL | Schema finally matches the note's vocabulary. Real regression risk. |

**A is recommended.** B's only benefit is naming, and the same clarity is already achieved by the comments
now sitting on both `lib/db/schema.ts` and `lib/llm/schemas.ts`. B also touches scoring maths and raw SQL —
a lot of exposure for a rename. If B is ever chosen, do it as its own CI with a full reader audit.

### 2.2 Current state — verify before acting

The reader count came from a grep on 2026-08-01 and **must be re-checked** before dropping anything:

```
grep -rn "requirementGroup\|requirement_group" --include=*.ts --include=*.tsx
```

Expect: `lib/db/schema.ts` (definition), `lib/pipeline/screening.ts` (write), `scripts/seed.ts` (write).
Any *read* means this note's premise has changed — stop and re-scope.

### 2.3 Acceptance criteria

- [ ] Grep confirms zero readers at the time of the change
- [ ] `requirementGroup` write removed from `screening.ts` and `scripts/seed.ts`
- [ ] Migration drops `requirement_group`
- [ ] `npx tsc --noEmit` clean; `npx vitest run` passing
- [ ] One live screening run writes requirements correctly with `rank` and `group_rank` intact
- [ ] `Process/B2…md` §B carries a line noting the schema field names differ from the note's vocabulary and
      why (so the divergence is documented rather than rediscovered)

---

## 3. Resources or references

- **Origin:** `[[B2 Returns Zero Requirements (Silent Extraction Failure + LLM Observability)]]` §4,
  2026-08-01 "The `rank` / `requirement_group` decision".
- **Code:** `lib/db/schema.ts` (`jobRequirements`) · `lib/pipeline/screening.ts` (B2 insert) ·
  `scripts/seed.ts` · readers of `rank`: `lib/queries.ts`, `lib/scoring.ts`, `lib/coaching-queue.ts`,
  `lib/pipeline/tailoring.ts`, `lib/interview.ts`, `lib/discover.ts`, `components/roleproof/*`.
- **Procedure:** `Process/B2. Extract Requirements from Job Description.md` §B.

---

## 4. Notes / Progress log

### 2026-08-01 · Opened

Split out of the B2 CI so the decision does not live only in a chat transcript. Nothing implemented.
`ci-roadmap: P6` — same shape as the `approval_status` rename already listed under
*Scheduled cleanup (P6, post-prototype)* in `docs/ROADMAP.md`.
