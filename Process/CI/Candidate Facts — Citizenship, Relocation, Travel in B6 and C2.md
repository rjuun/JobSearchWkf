---
ci-area: Profile / B6 & C2 processing
ci-roadmap:
ci-title: Candidate facts — citizenship, relocation, travel in B6 and C2
ci-status: 3 - Delivered
ci-priority: medium
ci-date: 2026-08-05
ci-estimated-time: 1
ci-time-spent: 1
pr-source:
pr-target:
---

---
```simple-time-tracker
{"entries":[{"name":"Design + implementation","startTime":"2026-08-05T18:30:00.000Z","endTime":"2026-08-05T19:38:00.000Z"}]}
```
---

> [!NOTE] Filed retroactively
> This was implemented directly, in the same conversation that raised it, without going through the
> normal idea → CI → build sequence — the owner asked for it inline while explaining the `evidence_kind`
> bug fix, and it was small enough to just build. This note exists so the change has the same paper trail
> as everything else, and so its files can be committed as one coherent unit rather than getting lost
> inside a much bigger, unrelated batch of commits from the same session.

---

## 1. What is the problem or opportunity?

Some JD requirements are eligibility gates rather than skill evidence — **"must have EU work authorization,"
"open to relocation," "must be able to travel 25%+."** Nothing in the profile captured these as structured
facts, so B6 (roadblock/misalignment screening) and C2 (requirement→evidence mapping) had no way to check a
posting's citizenship/relocation/travel requirements against the candidate, and the generated CV's contact
line had no way to state them either.

## 2. What would the improvement look like?

### 2.0 Scope

Two implementation shapes were considered: (a) a full Career Graph citizen — a new evidence kind with its
own Map lane and `CV_SLOTS` entry, matching how Education/Language work, or (b) fold the three facts into
the profile's contact line and into B6/C2's prompt context only, with no Map lane and no new evidence kind.
**(b) was chosen** — these are fixed candidate attributes, not evidence a JD requirement gets individually
mapped to and approved; a Map row implies "is this Kept for this CV," which doesn't apply to "I am an EU
citizen."

**In scope:** three new profile fields, B6/C2 prompt injection, CV contact-line inclusion, forward-compatible
`.docx` template placeholders.
**Out of scope:** a dedicated `CV_SLOTS` entry, a Career Graph node type, a Map lane, per-requirement
approval — all of which `evidence_kind`-gated Education/Language rows already do, and which candidate facts
deliberately don't need.

### 2.1 Schema

`profiles` gains three nullable `text` columns: `citizenship`, `relocation`, `travel`
(`lib/db/schema.ts` — same migration, `drizzle/0033_jittery_thunderball.sql`, that also added
`requirement_tailoring.evidence_kind`; the two are unrelated but were generated together).

### 2.2 Capture

`app/profile/identity/page.tsx` — three new inputs. `app/actions/profile.ts` (`saveIdentity`) persists them.

### 2.3 Summary builder

`lib/profile-context.ts` — new `candidateFactsSummary(profile)`: builds a "Citizenship / work authorization:
...", "Relocation: ...", "Travel: ..." multi-line block from whichever of the three are set, `''` if none are.

### 2.4 B6 and C2 injection

- `lib/pipeline/screening.ts` — `b6UserMessage()` gained a `candidateFacts?: string | null` parameter; the
  B6 block fetches the profile and passes `candidateFactsSummary(profile)` in.
- `lib/pipeline/tailoring.ts` — same pattern for `c2UserMessage()`, injected as a
  `CANDIDATE FACTS (fixed, not skill evidence — do not treat as a Map row)` text block, so the model can
  reason about eligibility without proposing an evidence link for it.

### 2.5 CV output

- `lib/pipeline/tailoring.ts` — `templateSlotData()` gained a `profile` parameter writing forward-compatible
  `data['Citizenship']` / `['Relocation']` / `['Travel']` keys (inert until the owner adds matching `<<...>>`
  tags to their own gitignored `Group CVs/CV_Template.docx`), and the `contact` string built in `generateCv()`
  was extended to include whichever of the three are set.

### 2.6 Acceptance criteria

- [x] Three fields save and reload correctly on the Identity page
- [x] `candidateFactsSummary` returns `''` when none of the three are set, and the correct multi-line block
      otherwise
- [x] B6 and C2 prompts include the candidate-facts block when present, absent when not
- [x] Contact line on the generated CV includes whichever facts are set
- [x] `npx tsc --noEmit` clean, `npx vitest run` passing (confirmed as part of the same session's broader
      tsc/vitest run — not isolated to this feature alone)
- [x] One live tailoring run confirms the fields flow through without error (same session, same lead runs
      that verified the `evidence_kind` fix)

### 2.7 Related cleanups riding along

Three small, undesigned changes from the same session, attached here rather than given their own CIs — none
is substantial enough to warrant a write-up on its own, and the owner chose to fold them into this note for
commit organization rather than leave them undocumented:

- **`languagesSummary` field deleted** — confirmed dead (unused downstream) via full-repo grep, when the
  owner asked what it was wired to while reviewing the Identity page changes above. Removed from
  `lib/db/schema.ts`, `app/profile/identity/page.tsx`, `app/actions/profile.ts`, `scripts/seed.ts`.
- **Dead `setApprovalAction` deleted** — the old single-row Keep/Maybe/Drop action in
  `app/actions/tailoring.ts`, confirmed unused (superseded by `approveAllAction`). Owner's call: *"Deleted.
  I prefer something breaks in the future and we need to rebuild from the future current state"* — i.e. no
  defensive rollback path kept.
- **`scripts/propose-skill-star-links.ts`** — new standalone report-only script (`--apply` for high-confidence
  writes only) proposing Skill→STAR links for unlinked skills. Run live by the owner: at the time, every
  skill already had at least one STAR link — nothing to propose.

---

## 3. Resources & references

- **Files:** `lib/db/schema.ts` · `drizzle/0033_jittery_thunderball.sql` · `drizzle/meta/0033_snapshot.json` ·
  `drizzle/meta/_journal.json` · `lib/profile-context.ts` · `lib/pipeline/screening.ts` ·
  `lib/pipeline/tailoring.ts` · `app/actions/profile.ts` · `app/profile/identity/page.tsx` ·
  `scripts/seed.ts` · `scripts/propose-skill-star-links.ts` (§2.7)
- Note: `lib/db/schema.ts` and `lib/pipeline/tailoring.ts` are **shared** with the larger C2/`evidence_kind`
  work from the same session (comment rewrites, `toRefresh` backfill, the C5 collapse guard) — they aren't
  purely this feature's files. Per the owner's call, both ship in the Career Graph Visualization commit
  instead of this one; listed here for the record, not as this note's own commit contents.
- `app/actions/tailoring.ts` (§2.7, `setApprovalAction` deletion) ships in the
  `CV Tailoring — Evidence Mapping Issues` commit, where the rest of that file's changes already live —
  not duplicated into this note's commit either.

---

## 4. Notes / Progress log

### 2026-08-05 · Built inline

Raised and implemented in the same conversation as the `evidence_kind`/Education-Language Map-lane bug fix.
The owner proposed three implementation shapes for surfacing citizenship/relocation/travel; chose the
"lighter" one (fold into contact line + prompt context, no Map lane) explicitly:
*"Implement now and consider that this specification should also be in the same C2."*

### 2026-08-06 · Filed retroactively for commit organization

No CI existed for this feature even though it was fully built — it was implemented directly rather than
going through idea → CI → build. Filed now, status set straight to Delivered, so the files above can be
identified and committed as one unit rather than folded anonymously into a much larger session's diff.

### 2026-08-06 · §2.7 added — three small cleanups attached here

`languagesSummary` deletion, the dead `setApprovalAction` deletion, and `scripts/propose-skill-star-links.ts`
folded in as their own section, per the owner's direction, rather than filed as separate CIs or left
undocumented. Note the actual file each ships in under §3 — not everything in §2.7 lands in this note's own
commit.
