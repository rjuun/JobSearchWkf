---
ci-area: CV Tailoring
ci-roadmap:
ci-title: C4 Skills Selection Produces Unreadable Overflow
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-07
ci-estimated-time:
ci-time-spent: 0
pr-source: "[[CV Header, Skills & Professional Experience — Data-Driven Template Wiring]]"
pr-target:
---

---

## 1. What is the problem or opportunity?

Wiring C4's `skillsModel` into the real CV Word template for the first time (2026-08-07 — it had never been
fed into the real template before that day; only an unused `CvModel` fallback path consumed it) exposed
that C4 produced **67 skill names in a single "Proficient:" line** for one lead (`b7e91408-666b-
4bd3-9aa2-feb760fc1036`, Allianz Partners, 30 Keep rows). Per the user, directly: *"according to the C4
procedure, we could never have come to 67 skills!!"* — C4's own docstring targets "3–5 categories × 4–8
skills" (~12–40 range). 67 in one category is not a large-Keep-set edge case; it means something upstream
tagged far more densely or far more often than C4's design ever intended.

**A display-layer cap of 24 items was added the same day as a stopgap** (`templateSlotData`,
`lib/pipeline/tailoring.ts`) so the CV itself stays readable. It does not touch C4's selection logic, its
categorisation (`Expert`/`Proficient` by proficiency only — the thematic categories a real CV shows, e.g.
"Governance & Compliance", don't exist as data; tracked separately as ROADMAP P6), or the deliberately
uncapped "every Keep bullet's tag must appear" consistency rule that produced the 67 in the first place.
**The cap hides the symptom. The cause is still open.**

## 2. What would the improvement look like?

Not scoped — this is a root-cause investigation, not a fix, until the investigation happens. At minimum:

1. Check `mySkills` volume across several other real leads (not just the one that surfaced this) — is 67 a
   one-off from an unusually large Keep set, or does C4 routinely run this dense and it just had nowhere to
   render until today?
2. Re-read `Process/C4...md`'s actual spec for what the "consistency rule" (every Keep bullet's tag must
   appear) was supposed to bound, and whether "uncapped" was ever meant to survive a 30-Keep-row lead.
3. Decide whether the fix is in C3 (is it tagging every bullet with fresh, uncurated vocabulary on each
   rewrite rather than drawing from a fixed skill list?), in C4's grouping (proficiency-only buckets aren't
   what a real CV needs), or both.

## 3. Resources or references

- `lib/pipeline/tailoring.ts` — C4's skill-selection block (`skillsModel` construction, the mandatory
  consistency-rule loop, the `TARGET = 12` top-up cap that never bounds the mandatory phase); the 24-item
  display cap added 2026-08-07 in `templateSlotData`.
- `[[CV Header, Skills & Professional Experience — Data-Driven Template Wiring]]` — where the cap was added
  and where this was first surfaced; that note's progress log has the exact reproduction (lead id, counts).
- Memory: `c4-skills-overflow-bug.md` (auto-memory) — the same finding, saved for cross-session recall.

## 4. Notes / Progress log

### 2026-08-07 · Opened as an Idea

Surfaced while verifying the Skills tag wiring end-to-end against a real lead. The user explicitly asked
this be tracked as unresolved rather than considered closed by the display cap, and set it as the highest
priority of the three Ideas opened the same day.
