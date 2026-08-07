---
ci-area: Data Model
ci-roadmap:
ci-title: Areas of Expertise and JD Groups — Persistent Data Model
ci-status: 0 - Idea
ci-priority: low
ci-date: 2026-08-07
ci-estimated-time:
ci-time-spent: 0
pr-source: "[[CV Header, Skills & Professional Experience — Data-Driven Template Wiring]]"
pr-target:
---

---

## 1. What is the problem or opportunity?

B5 (`Process/B5. Translate Requirements to Areas of Expertise and Define JD Groups.md`) rates every lead
against a 17-code Areas of Expertise framework (A–Q) and assigns a Primary/Secondary JD Group, but none of
that framework is stored data — the 17 codes and their names, and the 6 JD Group definitions plus their
decision rules, exist only as prose in that one process note. `job_leads.skillRatings` (jsonb, keyed A–Q),
`jdGroupPrimary`, `jdGroupSecondary`, and `keyPatterns` persist the *output* of a B5 run, but only per lead
— there is nowhere the results are ever rolled up across leads.

`jdGroups` (`lib/db/schema.ts`) already exists as a table — `code`, `name`, `description` — but it has
never been populated or read anywhere in the app. It's a stub.

Confirmed 2026-08-07 while wiring the CV Header's JD Group Primary/Secondary line: that one field needed no
new schema (it just reads the current lead's own `job_leads` row), but the bigger ask behind it — using
this data to "identify and re-orient the kinds of position I am applying to" over time — genuinely has
nothing to read from yet.

## 2. What would the improvement look like?

Not scoped in detail — parked as an Idea. At minimum:
- Populate `jdGroups` with the real 6 groups (code, name, the "Primary signal" decision rule from B5 §A)
  so it stops being a stub.
- Add a proper `areas_of_expertise` reference table for the 17 A–Q codes (code, name), since none exists.
- Design a rollup of `job_leads.skillRatings`/`jdGroupPrimary` across every scored lead — decide whether
  this is a live query, a materialized snapshot, or an events-style log, and whether it lives as its own
  page, folds into the Career Graph, or is a periodic digest. This decision was explicitly deferred rather
  than guessed at when it first came up.

## 3. Resources or references

- `Process/B5. Translate Requirements to Areas of Expertise and Define JD Groups.md` — the 17-code
  framework and 6 JD Group definitions, currently prose-only.
- `lib/db/schema.ts` — `jdGroups` (stub, unpopulated), `job_leads.skillRatings`/`jdGroupPrimary`/
  `jdGroupSecondary`/`keyPatterns` (per-lead only).
- `[[CV Header, Skills & Professional Experience — Data-Driven Template Wiring]]` — where the per-lead
  half of this (Header's JD Group line) was actually wired; this note is only the aggregation half.

## 4. Notes / Progress log

### 2026-08-07 · Opened as an Idea

Identified while wiring the CV Header's JD Group Primary/Secondary line. The user named the real stakes
directly: this isn't just a CV Header detail, it's meant to help "identify and re-orient the kinds of
positions I am applying to" over time — but confirmed there's no DB-backed home for that yet, and the
larger design (rollup shape, where it surfaces) was deliberately deferred rather than built ad hoc. Priority
set to Low per the user's own triage against the other Ideas opened the same day.
