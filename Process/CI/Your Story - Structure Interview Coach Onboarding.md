---
ci-area: Onboarding
ci-roadmap:
ci-title: Your Story - Structure Interview Coach Onboarding
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

The Career Graph work (R7) surfaced the near-term slice of this: `/profile/story` now shows a static "Structured interviews" sequence — six proposed one-hour session Groups covering the BDO Work Sheets New Placement content — as a first step toward this. It's display-only today; nothing conducts the interview yet.

## 2. What would the improvement look like?

**In scope now (not yet built):** turn the static Groups sequence on `/profile/story` into something a job seeker can actually run through — one Group at a time, questions from the BDO method, answers landing as draft Career Graph nodes (positions, STARs, actions, results, competences, attributes, skills) that the user then approves, same as any other coached evidence.

**Deferred (the original framing of this note, kept for context):** a full in-app *consultant-style AI interview agent* — a robot conducting the reflective process end-to-end, one theme at a time, drawing the story out of the person the way a human consultant does. That's a materially bigger build (conversational state machine, multi-turn extraction, tone/pacing matching a real consultant) and was judged too far-fetched to tackle now. The nearer-term version above — a guided, semi-structured flow through the six Groups, with the human still doing the writing/talking and the app doing the structuring and extraction — is the one to build first; the full agent can absorb this note's original scope later if it still makes sense once the guided flow exists.

Crucially, either version preserves the guardrails already in the system:
- **AI drafts, the human commits** — nothing enters the trusted graph until the user approves it.
- **Truthfulness** — the agent never invents a metric; a missing result becomes a follow-up question, never a fabricated number.
- **Reflection over speed** — the job is to elicit depth, not to fill fields quickly.

**Current state (as of this rescoping):**
- `/profile/story` renders the six Groups (`INTERVIEW_GROUPS` in `app/profile/story/page.tsx`) as a static, informational card — title, blurb, and which BDO sections each covers. No interaction beyond reading.
- `/profile?view=meter` carries the live, DB-wired Career Graph visualization (`components/roleproof/career-graph-view.tsx`) that this interview flow would eventually feed.
- No interview UI, no per-Group question set beyond the BDO document itself, and no draft-node extraction pipeline exists yet.

## 3. Resources or references

- BDO career-design method — "Work Sheets New Placement" (the source method book; all 32 sections read and grouped into the six Groups above)
- [[Profile Reference Workbook]] — the instrument a completed interview ultimately populates
- `app/profile/story/page.tsx` — where the Groups sequence lives today (static)
- `components/roleproof/career-graph-view.tsx`, `lib/career-graph-view-model.ts` — the live graph this flow feeds
- `docs/design/career-graph-visualization.html` — the design mockup the live graph was built from
- `docs/design/ONBOARDING_SPEC.md` — onboarding design principles (see the two
  onboarding-philosophy principles at the top)
- `Process/Onboarding/O2 Extract Career Graph.md` — the existing extraction prompt
  (document-import path, currently to be disabled in the UI)

## 4. Notes / Progress log

- 2026-07-22 — Raised (then titled "Onboarding — Consultant-Guided Interview Agent"). Precondition noted: disable the CV/LinkedIn auto-import path in the onboarding wizard (keep in codebase, hide in UI) so the reflective path is the clear front door.
- 2026-08-05 — Rescoped. The original framing (a full AI robot-led interview agent) was judged too far-fetched to tackle now; recycling this note for the nearer-term, concrete piece instead — turning the Groups sequence just added to `/profile/story` into an actual guided flow. Renamed from "Onboarding — Consultant-Guided Interview Agent" accordingly; the original framing is kept above under "Deferred" rather than deleted, per the CI rescoping convention. Status stays `0 - Idea` — not started. Priority left at `medium` (unchanged); flagging that "MM" was mentioned when parking this — read here as shorthand for `ci-priority: medium`, since a 2-character `ci-roadmap` code of "MM" doesn't correspond to any wave in `ROADMAP.md`. Correct here if that's not what was meant.
