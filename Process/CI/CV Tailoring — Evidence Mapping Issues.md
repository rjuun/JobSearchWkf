---
ci-area: Tailoring / Requirement-Evidence Map
ci-roadmap:
ci-title: CV Tailoring — evidence mapping issues
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-04
ci-estimated-time: 2
ci-time-spent: 2
pr-source:
pr-target:
---

---
```simple-time-tracker
{"entries":[{"name":"Evidence-kind Map-lane gating fix","startTime":"2026-08-04T09:00:00.000Z","endTime":"2026-08-04T10:00:00.000Z"},{"name":"Scoring Queue missing promoted/tailoring leads","startTime":"2026-08-05T09:00:00.000Z","endTime":"2026-08-05T10:00:00.000Z"}]}
```
---

> [!NOTE] Filed retroactively, two issues in one note
> Both defects were found and fixed live, in the same conversation, while the owner was working a real
> lead through Map → Approve → Generate CV. Neither got its own CI at the time. Filed together now, as two
> sections rather than two files, on the owner's call — they're both small, both already delivered, and
> both surfaced from the same round of hands-on testing.

---

## 1. What is the problem or opportunity?

Two structural bugs in how the C2 evidence map and the Scoring Queue read `job_leads`/`requirement_tailoring`
state, both caught by the owner actually using the app rather than by a written spec:

**A. Education/Language evidence was invisible and unapprovable.** `evidenceNeedsCvSlot` gating and the
Map's lane rendering were both built around `cvPosition`, but Education/Language evidence structurally never
gets one — those CV sections render unconditionally from the `education`/`languages` profile tables, not
from `CV_SLOTS`. So rows of this kind were stuck: blocked from approval by a slot check that could never be
satisfied, and invisible in their Map lane because the lane was keyed on the same field.

**B. The Scoring Queue silently dropped leads once they progressed.** `scoringQueueData()` and `flowCounts()`
(`lib/queries.ts`) filtered on a narrow set of lead statuses that didn't include `promoted`/`tailoring`/
`ready` — so a lead the owner was actively tailoring disappeared from the queue view entirely, with no
error, just absence.

## 2. What would the improvement look like?

### 2.1 Evidence-kind Map-lane gating (Education/Language)

**Fix:**

- `lib/cv-slots.ts` — new `evidenceNeedsCvSlot(kind: string | null): boolean`, returning `false` only for
  `'Education'`/`'Language'`. `kind === null` (legacy rows) is treated as "needs a slot" — the stricter,
  pre-existing behaviour, so nothing that used to be blocked silently unblocks.
- `app/actions/tailoring.ts` (`approveAllAction`) — a `hasSlotOrExempt` helper applied to both the
  `toApprove` and `skipped` filters, so exempt rows clear the gate.
- `components/roleproof/workspace.tsx` — `RpRow` gained an `evidenceKind` field; `onApproveAll()`'s
  optimistic filter and `ApproveMapCard`'s approvable/blocked split both switched to
  `evidenceNeedsCvSlot`; and — the actual root cause of the Map-lane invisibility — the Map's
  `evidence={c.rows.map(...)}` block now keys non-slot rows by `evidenceRef` instead of `cvPosition`,
  mirroring how B6's own `getInitialEvidence` already keyed non-Bullet lanes.
- `app/roleproof/leads/[id]/page.tsx` — `evidenceKind` added to the `tailoringRp` mapping so it actually
  flows from the DB through to the components above.

**A second bug surfaced while testing the fix**: two Language rows stayed `evidence_kind = NULL` even after
this shipped, because they were written before the column existed and `planMerge`'s "unchanged" branch
(when a re-matched evidence doesn't score higher) left old rows completely untouched — including a stale
`NULL` that could never self-heal through normal re-mapping. Fixed with a `toRefresh` bucket in `planMerge`
and a corresponding lightweight `UPDATE ... SET evidence_kind = ...` in `runEvidenceMapping`, patching only
`evidence_kind` — never `approvalStatus`/`connectionToExpertise`/`approvedAt`. **This code lives in
`lib/pipeline/tailoring.ts`, which ships in the Career Graph Visualization commit** (bundled there per the
owner's call on the shared-file split) — noting it here so the fix isn't orphaned from its own writeup.

**Acceptance:**

- [x] Education/Language rows render in their Map lane, keyed by `evidenceRef`
- [x] Bulk-approve treats Education/Language rows as exempt from the CV-slot requirement
- [x] A `NULL` `evidence_kind` on an old row backfills on the next re-map without touching approval state
- [x] Live-verified: owner re-mapped a real lead, both Language bullets connected and approved

### 2.2 Scoring Queue missing promoted/tailoring leads

**Fix:** `lib/queries.ts` — `scoringQueueData()`'s `inArray` widened to include `'promoted'`, `'tailoring'`,
`'ready'` alongside the existing statuses; the `results` bucket filter and `flowCounts()`'s `results` count
widened the same way.

**Acceptance:**

- [x] A lead at `promoted`/`tailoring`/`ready` status appears in the Scoring Queue
- [x] Live-verified: owner confirmed the previously-missing promoted lead reappeared

---

## 3. Resources & references

- **Files (this note's own commit):** `lib/cv-slots.ts` · `app/actions/tailoring.ts` ·
  `components/roleproof/workspace.tsx` · `app/roleproof/leads/[id]/page.tsx` · `lib/queries.ts`
- **Related, ships elsewhere:** `lib/pipeline/tailoring.ts` (`toRefresh` / `planMerge` — see §2.1) —
  bundled into the Career Graph Visualization commit, not this one.

---

## 4. Notes / Progress log

### 2026-08-04 → 2026-08-05 · Found and fixed live

Both issues surfaced while the owner worked a real lead through Map → Approve → Generate CV in the same
extended session. Neither was pre-scoped as a CI; both were small enough to fix on the spot. Filed
retroactively on 2026-08-06 for commit organization, at the owner's direction, as two sections of one note
rather than two separate files.
