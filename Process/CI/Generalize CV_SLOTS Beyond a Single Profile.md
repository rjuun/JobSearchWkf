---
ci-area: Data Model
ci-roadmap:
ci-title: Generalize CV_SLOTS Beyond a Single Profile
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-08-07
ci-estimated-time:
ci-time-spent: 0
pr-source: "[[CV Header, Skills & Professional Experience - Data-Driven Template Wiring]]"
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

### 2.0 · The organising rule, set by the owner 2026-08-28

> *"Only Section Headings as static, everything else should be fed from fields from the db."*

One sentence, and it settles §2's third question outright. Measured against the template as it stands
(2026-08-28), here is what that rule would remove:

```
STATIC today                                     under the rule
-------------------------------------------------------------------
PROFILE / SKILLS / PROFESSIONAL EXPERIENCE       stays  — section heading
EDUCATION / EXECUTIVE EDUCATION / LANGUAGES      stays  — section heading
"Direct Reports: 1 Sr. Analyst and 3 Analysts"   goes   — this owner's headcount, as literal text
"Key Projects:"                                  goes   — already made data by the C7 space CI
<<Position A Header>> … <<Position D Header>>    goes   — exactly four positions, hard-coded
A1. Outsourcing Framework Project                goes   ─┐
A2. Governance Transformation Project            goes    │  every one of this owner's real
A3. BBAG Wind Down Project                       goes    ├─ projects, as a tag NAME inside
B1. Accounting Correction Layer Project          goes    │  the document
B2. Transfer Pricing · C1. BBSA Merger           goes    │
D1. Servicing Center Project                     goes   ─┘
```

**The template is not a generic CV with this owner's data in it — it is this owner's CV with holes.**
A second tenant cannot use it at all, because their projects are not called *BBAG Wind Down*.

### 2.0.1 · What the rule produces, and the consequence §2 did not anticipate

Section headings, plus two nested loops:

```
PROFESSIONAL EXPERIENCE
<<#positions>>
  <<title>> at <<company>>, <<city>>            <<dates>>
  <<#directReports>>Direct Reports: <<.>><</directReports>>
  <<#overview>><<.>><</overview>>
  <<#projects>>
    <<caption>>
    <<#bullets>><<.>><</bullets>>
  <</projects>>
<</positions>>
```

Roughly **ten paragraphs where there are now about seventy**, and not one name in the document.

**The consequence: one template serves every tenant.** §2 asks whether *"a second tenant needs either
their own template or a templating layer that isn't 'edit the docx XML by hand'"*. Under this rule the
answer is neither — nothing tenant-specific is left in the file, so one template serves everyone.
Separate templates would then distinguish **CV formats** (a different visual methodology), never
different people.

It also removes the hazard the C7 work kept running into: a document a human edits by hand in Word,
carrying seventy tags, where a stray edit can silently break a tag nobody notices until a render. Ten
generic tags is a much smaller surface.

### 2.0.2 · What this does not settle

`CV_SLOTS` and `CV_SLOT_STAR_REF` are still code. The rule fixes the *document*; the two questions
above it — whether slots become a per-owner table, and whether the slot↔STAR map becomes derivable —
are unchanged and still need answering. A generic template fed from a hard-coded eleven-slot array is
only half the move.

**Related work already pointing this way.** [[Never Render a Position Header Over Nothing]] wraps four
position headers and two `Direct Reports` lines in conditionals so an empty trailing position can be
omitted. That is the same move — structure out of the template, into data — applied to six paragraphs.
It is a step along this road, not a detour from it.



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
- `[[CV Header, Skills & Professional Experience - Data-Driven Template Wiring]]` — the `cv_structure`
  proposal table and the concrete field-level additions this session made toward it.

## 4. Notes / Progress log

### 2026-08-07 · Opened as an Idea

Named directly by the user as the thing this whole session's `cv_structure` work was building toward, but
explicitly not to be tackled yet — parked as an Idea at Medium priority, behind the C4 skills bug (High)
and ahead of the Areas-of-Expertise rollup (Low).
