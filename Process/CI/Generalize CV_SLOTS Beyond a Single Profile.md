---
ci-area: Data Model
ci-roadmap:
ci-title: Generalize CV_SLOTS Beyond a Single Profile
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-08-07
ci-estimated-time:
ci-time-spent: 0
pr-source: "[[CV Header, Skills & Professional Experience — Data-Driven Template Wiring]]"
pr-target:
---

---

## 1. What is the problem or opportunity?

Per the user's own framing, directly: *"I don't want anything 'hardcoded' in the software: neither CV
Structure, nor the Requirement-Evidence Map or the Evidence Picker. At the moment it reflects 'my story'.
When it becomes an open App, it will need to reflect 'every single individual story' based on the career
graph."*

Two things are still hardcoded to this one profile, both deliberately — each explicit instruction that
created them said so at the time — but both are exactly the kind of hardcoding that blocks a second tenant:

- `lib/cv-slots.ts`'s `CV_SLOTS` array — 11 literal strings naming this profile's actual project names
  (`"Professional Experience - A1. Outsourcing Framework Project"`, etc.). A different owner's career graph
  has different projects, different position letters, possibly a different number of slots entirely.
- `lib/career-graph-view-model.ts`'s `CV_SLOT_STAR_REF` — a hardcoded slot-code → STAR-refCode map, built by
  reading this owner's real `stars` table once and writing the answer into code (per
  `[[Fix CV Bullet Evidence Linking in the Career Graph]]`, which explicitly chose this over a runtime
  fuzzy-matcher and explicitly scoped it to "this one profile" at the time).

The `cv_structure` proposal table built 2026-08-06/07 (see the source CI) is a first step toward the
*data model* this should become, but it's still just a design table and a handful of new columns
(`education.summary`, `languages.displayLevel`, `positions.cityCountry`) — not the generic mechanism
itself. `CV_SLOTS` and `CV_SLOT_STAR_REF` are unchanged.

## 2. What would the improvement look like?

Not scoped — this is the multi-tenant version of everything this session did for one profile. At minimum,
the questions to answer before designing it:

- Does `CV_SLOTS` become a real per-owner DB table (positions × project count, in order), replacing the
  hardcoded array?
- Does `CV_SLOT_STAR_REF`'s mapping become derivable at runtime once slot↔STAR is a real relationship
  rather than a name-matching problem — or does every owner still need one human-confirmed pass to build
  their own version of that map, just stored as data instead of code?
- How does the CV_Template.docx itself generalize — right now its `<<...>>` tags are literal strings baked
  into one Word document per methodology's format; a second tenant needs either their own template or a
  templating layer that isn't "edit the docx XML by hand."

## 3. Resources or references

- `lib/cv-slots.ts` — `CV_SLOTS`, the array to generalize.
- `lib/career-graph-view-model.ts` — `CV_SLOT_STAR_REF`, `CV_SLOT_LETTER_POSITION`.
- `[[Fix CV Bullet Evidence Linking in the Career Graph]]` — where `CV_SLOT_STAR_REF` was built and
  explicitly scoped to this one profile.
- `[[CV Header, Skills & Professional Experience — Data-Driven Template Wiring]]` — the `cv_structure`
  proposal table and the concrete field-level additions this session made toward it.

## 4. Notes / Progress log

### 2026-08-07 · Opened as an Idea

Named directly by the user as the thing this whole session's `cv_structure` work was building toward, but
explicitly not to be tackled yet — parked as an Idea at Medium priority, behind the C4 skills bug (High)
and ahead of the Areas-of-Expertise rollup (Low).
