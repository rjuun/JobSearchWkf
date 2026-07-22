---
ci-area: Onboarding
ci-title: Consultant-Guided Interview Agent
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-07-22
ci-estimated-time:
ci-time-spent:
pr-source:
pr-target:
---

---
```simple-time-tracker
```
---

## 1. What is the problem or opportunity?

Today, building a trustworthy Career Graph depends on face-to-face time with a career consultant who guides the job seeker through the BDO reflective method (purpose, passions, personality, strengths → story → positioning) and captures the results in the Profile Reference Workbook. This human-led elicitation is the real source of value — it produces deep, honest self-knowledge rather than scraped data — but it does not yet exist inside the app. The current in-app onboarding leans on document import (CV/LinkedIn), which inverts the method: a CV is the *output* of good positioning, not a trustworthy *input* to self-understanding.

## 2. What would the improvement look like?

An in-app **consultant-style interview agent** that guides the job seeker through
the reflective process the human consultant runs today — asking the structured,
open questions from the method (achievements, STAR collection, values & motives,
definition of success, career vision), one theme at a time, and processing the
answers into draft Career Graph nodes (positions, STARs, actions, results,
competences, skills).

Crucially, this preserves the guardrails already in the system:
- **AI drafts, the human commits** — nothing enters the trusted graph until the
  user approves it.
- **Truthfulness** — the agent never invents a metric; a missing result becomes a
  follow-up question, never a fabricated number.
- **Reflection over speed** — the agent's job is to elicit depth, not to fill
  fields quickly.

The ideal end state is an experience that feels like sitting with a warm,
competent consultant: it draws the story out of the person, reflects it back,
and helps them see their own value clearly — then captures it faithfully into the
workbook and/or the database.

## 3. Resources or references

- BDO career-design method — "Work Sheets New Placement" (the source method book)
- [[Profile Reference Workbook]] — the instrument the interview populates
- `docs/design/ONBOARDING_SPEC.md` — onboarding design principles (see the two
  onboarding-philosophy principles at the top)
- `Process/Onboarding/O2 Extract Career Graph.md` — the existing extraction prompt
  (document-import path, currently to be disabled in the UI)

## 4. Notes / Progress log

- 2026-07-22 — Raised. Precondition: disable the CV/LinkedIn auto-import path in the
  onboarding wizard (keep in codebase, hide in UI) so the reflective path is the
  clear front door. This interview-agent work is the eventual replacement for that
  import path.