---
ci-area: CV Tailoring
ci-roadmap:
ci-title: Split cv_bullet_skills from requirement_skills
ci-status: 2 - Testing
ci-priority: medium
ci-date: 2026-08-23
ci-estimated-time: 2
ci-time-spent: 1
pr-source: "[[C4 Skills Selection Produces Unreadable Overflow]]"
pr-target: "[[C4. Transform Evidence into CV Bullets]], [[C5. Build and Manage the Skills Section]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Built 2026-08-23 — see §4
> The owner's framing when opening it: *"For process transparency — after `requirement_skills` are
> drawn (B2) and `my_skills` are found as evidence (C2), should we have a `cv_bullet_skills` column
> which clearly determines which `requirement_skills` are properly matched (C3)?"* Answer: yes. Built
> and migrated the same day, ahead of the first live pipeline run, so new leads' data lands in the
> right shape rather than needing a second pass. **One part of §2 was deliberately NOT shipped — the
> coverage-gap UI. §4 says why.**

---

## 1. What is the problem or opportunity?

`requirement_tailoring.requirement_skills` is **overloaded**. It holds two different things at two
different points in the pipeline, and nothing on the row tells you which one you are looking at:

| When | What the column holds | Written at |
| --- | --- | --- |
| After C2 | B2's requirement-level skills — what the JD asks for | `lib/pipeline/tailoring.ts`, the C2 insert (`requirementSkills: req.skills ?? []`) |
| After C3 | C3's per-bullet bracketed tag — what the bullet actually displays | `lib/pipeline/tailoring.ts`, the C3 write-back (`.set({ cvBullet, requirementSkills: bulletSkills })`) |

Three consequences, all live today:

**a. The review UI is mislabelled after C3 runs.** `components/roleproof/workspace.tsx` renders a badge
captioned **"Req. Skills"** on each tailoring row. Post-C3 that badge is showing C3's bullet tag, not
the requirement's asks. The owner cannot see the difference because there is nowhere for the difference
to live.

**b. The coverage signal cannot be computed.** B2 may extract four skills for a requirement; C3 writes
two as the tag. The other two disappear from the row with no record. `requirement_skills` minus
`cv_bullet_skills` would be exactly *"what this requirement asked for that this bullet did not
evidence"* — a per-row gap signal the app currently has no way to produce. This is the "properly
matched" question in the owner's framing.

**c. Re-running C3 compounds instead of re-deriving.** The fallback reads
`matched?.skills ?? row.requirementSkills`, and `row.requirementSkills` is already C3's own output from
the previous run. A second pass never sees B2's list again.

**What is NOT a problem** (settled explicitly, 2026-08-23 — do not re-litigate it): a bullet that
answers several requirements carries the **same** skills array on each of those rows. That is accurate,
not lossy — a bullet appears once on the CV and carries one bracketed tag, so one array per ref is the
truth about the document. Measured on lead `b7e91408`: 64 Keep rows over 30 distinct bullets, 16 of the
30 serving more than one requirement, one serving six. C4 compiles every row's array, dedupes and groups
per its own procedure, so row multiplicity cannot affect the Skills section either.

**One concrete residue worth folding in.** `absorbC3Bullets` (`lib/pipeline/tailoring.ts`) is
`into.set(b.ref, …)` — last writer wins. C3's prompt lists a shared bullet once per Keep row (six times
for that one ref) and asks for "one bullet per ref"; nothing enforces it. A reply that returns several
entries for one ref keeps whichever came last and silently discards the rest. Small, but it is the same
per-ref/per-row seam this CI is tidying. **Withdrawn on inspection — see §2.7. It is not a defect.**

## 2. What would the improvement look like?

Not scoped in detail — this is the shape, not a committed plan.

**One writer per column, one meaning per column.**

| Column | Meaning | Sole writer |
| --- | --- | --- |
| `requirement_skills` | What the JD asks of this requirement (B2's extraction), snapshotted at C2 and never overwritten | C2 |
| `my_skills` | The candidate's own vocabulary that answers it — C2's validated selection from the curated tables | C2 |
| `cv_bullet_skills` *(new)* | What the tailored bullet actually displays — the bracketed tag, or the bolded inline skill | C3 |

Leaving `requirement_skills` untouched after C2 matches this table's existing discipline: `original_text`
is snapshotted for exactly the same reason — so a later edit cannot silently rewrite what a decision was
based on (`Process/C2…md` §G).

Sketch of the work:

1. Schema: add `requirement_tailoring.cv_bullet_skills jsonb default '[]'` + a `drizzle/00XX_*.sql`
   migration (latest today is `0036_fearless_hobgoblin.sql`).
2. C3: write the tag to `cv_bullet_skills`; stop writing `requirement_skills`.
3. C4: source `buildSkillsSection` from `cv_bullet_skills` — which is then *literally* "the skills
   associated with the tailored cv_bullets", with no ambiguity about which of the two columns is meant.
   `lib/pipeline/skills.ts` needs only its field renamed; the selection logic is unchanged.
4. UI: show all three on the review row, correctly labelled, and surface the gap
   (`requirement_skills` − `cv_bullet_skills`) — that is the whole point of the split.
5. Backfill: existing rows carry C3's tag in `requirement_skills`. It is recoverable, not lost — copy
   `requirement_skills` → `cv_bullet_skills` for rows where C3 has run, then restore
   `requirement_skills` from `job_requirements.skills` via the `requirement_id` join. Decide whether
   this is worth a script or whether re-running C2/C3 per lead is simpler.
6. Fold in the `absorbC3Bullets` last-writer-wins seam noted in §1.
7. Docs: `Process/C3…md` §B.5 and its persistence section (currently "your `skills` become
   `requirement_skills`"), `Process/C4…md` §A, `docs/DATA_MODEL.md`, `docs/PIPELINE.md`.

**Explicitly out of scope:** making C3 emit a tag per *(ref, requirement)* rather than per ref. A bullet
displays one tag on the CV, so per-requirement tags would not correspond to anything the document can
show.

### 2.5 · What was built (2026-08-23)

- **Schema** — `requirement_tailoring.cv_bullet_skills jsonb default '[]'`,
  `drizzle/0037_strange_newton_destine.sql`, applied.
- **C3** writes its tag to `cv_bullet_skills` and no longer touches `requirement_skills`. The
  fallback for a row with no `evidenceRef` is `[]`, deliberately, not the requirement's asks: C3 is
  keyed by ref, so such a row's bullet is the untailored `originalText` and carries no bracketed tag.
  Substituting the asks would print skills no bullet displays — the same class of false claim as a
  near-miss vocabulary match. No such row exists in the live data; this is about which way it fails.
- **C4** sources `cv_bullet_skills`. `buildSkillsSection`'s field renamed; selection logic untouched.
- **UI** — the review row shows three labelled badge rows: *Asked for* / *My Skills* / *On the bullet*.
- **Backfill** — `scripts/backfill-cv-bullet-skills.ts` (report-only; `--apply` writes). Moves C3's
  tag out of `requirement_skills` into the new column, then restores `requirement_skills` from
  `job_requirements.skills`. Applied: 64 tags moved, 64 restored. Verified the Allianz lead's Skills
  section returns 16 items — it drops to **0** without the backfill, since the new column starts empty.

### 2.6 · NOT shipped: the coverage-gap badge

§2 step 4 called for surfacing `requirement_skills` − `cv_bullet_skills` on the review row. It is
computable now, and the audit script prints it — but it is **not** shown in the UI, because the only
honest implementation today is exact string match and **C3 rewords almost every ask**:

| B2 asked for | C3's tag |
| --- | --- |
| Stakeholder management · Board-level communication · Senior management liaison | Stakeholder Management With Senior Leadership |
| PowerPoint presentation creation · Decision proposal drafting · Steering dashboard preparation | Decision Documents Preparation · Executive Support |
| Meeting management · Agenda preparation · Action tracking · Follow-up coordination | Meeting & Event Management |

Literal comparison scores **48 of 49** asks as missing on the Allianz lead, nearly all of them false —
those skills *are* evidenced, in different words. A badge that fires on every row teaches the reviewer
to ignore it, which is worse than no badge. Closing the gap needs the wording question settled first:
**blocked on [[Skill Name Treatment in the C5 Skills Section]]**. `scripts/audit-c4-skills-density.ts`
prints the literal comparison meanwhile, labelled "NOT MATCHED LITERALLY" rather than "not evidenced".

Note what this table also shows, which matters for that CI: **B2's extraction is the more specific of
the two.** "PowerPoint presentation creation" is a sharper CV skill than "Executive Support". The
awkward names on the printed Skills section — "Work Autonomously", "MS Office Proficiency", "Fluency
in German and English" — are C3's phrasing, not B2's.

### 2.7 · Withdrawn: the absorbC3Bullets seam

§1 flagged `absorbC3Bullets`' last-writer-wins on duplicate refs as part of the same per-ref/per-row
seam. On inspection it is not a defect and no change was made. Across re-asks, later-wins is the
deliberate, test-pinned behaviour (`c3-bullet-floor.test.ts`: "lets a later real bullet replace an
earlier one"). Within one reply, several entries for one ref are each a valid rewrite of the same
evidence, one bullet per ref is all the CV can show, so picking the last loses nothing. Documented in
the function so it does not get re-filed as a bug.

## 3. Resources or references

- `lib/pipeline/tailoring.ts` — the C2 insert, the C3 write-back, `absorbC3Bullets`, and the C4 block
  that reads the column.
- `lib/pipeline/skills.ts` / `lib/__tests__/c4-skills.test.ts` — `KeepRowSkills.requirementSkills` is
  the field that would be renamed; the tests pin the behaviour that must not change.
- `components/roleproof/workspace.tsx` — the "Req. Skills" / "My Skills" badge rows.
- `lib/llm/schemas.ts` — `C3.zod` / `emit_cv_bullets`, where the per-bullet `skills` array is defined.
- [[C4 Skills Selection Produces Unreadable Overflow]] — established that C4 prints the bullets' skills;
  this CI makes the column say so unambiguously.
- [[Requirement Skills vs My Skills - Two-Column Redesign (Epic)]] — the two-column design this extends
  to three. Its §3 is where "C3 write-back of its skills judgment" first landed on `requirement_skills`.

## 4. Notes / Progress log

### 2026-08-23 · Built, migrated and backfilled

Brought forward and implemented the same day it was opened, at the owner's request — he asked for the
column *before* the first live pipeline run so a new lead's data would land in the right shape rather
than needing a second pass. See §2.5 for what shipped, §2.6 for the one part deliberately held back.

The backfill surfaced the finding in §2.6's table: restoring `requirement_skills` from
`job_requirements.skills` made visible, for the first time, how far C3's tags drift from B2's own
extraction. That is now the strongest input to [[Skill Name Treatment in the C5 Skills Section]].

### 2026-08-23 · Opened as an Idea

Raised by the owner immediately after [[C4 Skills Selection Produces Unreadable Overflow]] shipped, as a
process-transparency question.

An earlier framing of this note treated the per-ref/per-row multiplicity as a fidelity problem — that a
bullet serving six requirements makes the "properly matched" comparison approximate. **The owner
corrected that and he is right:** the *(requirement, evidence)* row is preserved, one bullet carries one
tag because it appears once on the CV, and C4 compiles and dedupes across rows regardless. The per-row
comparison is exact. That objection is withdrawn and should not resurface — the case for the column
rests entirely on the overloading in §1.
