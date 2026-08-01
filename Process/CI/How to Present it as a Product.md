---
ci-title: How to Review the Roadmap so RoleProof Can Be Presented as a Product
ci-area: Product / Demo Readiness
ci-roadmap:
ci-status: 1 - Development
ci-priority: high
ci-date: 2026-07-03
ci-estimated-time:
ci-time-spent:
pr-source:
pr-target: "[[docs/ROADMAP]]"
---


---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-07-03T09:34:04.000Z","endTime":"2026-07-03T10:13:32.000Z"}]}
```
---

## 1. What is the problem or opportunity?

Reframed 2026-08-01. Originally opened 2026-07-03 as "How to Present it as a Product" — a first
attempt to put a ceiling on scope before demoing the app to others — and left blank for a month.
It sat unwritten because the boundary it was trying to draw, "what must be done vs. what can wait,"
is exactly what `docs/ROADMAP.md` already exists to do. Writing a second document to hold the same
distinction would have created two competing sources of truth.

The real gap wasn't a missing feature list. It was that nobody had walked ROADMAP.md end-to-end and
asked, surface by surface: does this satisfy "presentable to others," or is there unwired UI still
showing? This note now does that walk and becomes the standing procedure for repeating it.

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:** a repeatable procedure for reviewing ROADMAP.md against demo-readiness; this pass's
findings — the must-finish/future split for Career Graph, Leads, and Dashboard; the resulting link
from those findings into Process/CI, so nothing gets decided twice.

**Out of scope:** building any of the fixes below. Each becomes its own CI item (or continues under
one already in flight) once opened.

### 2.1 The review procedure

1. **ROADMAP.md is the source of truth for "done," not this note.** Phases P0–P5 are each marked
   done with an explicit Acceptance/demo line. `docs/DEMO_RUNBOOK.md`'s 5-step click-path (Career
   Graph → Coach → Leads → a screened lead → the ready CV) is the operational definition of
   "presentable" — it's the script a real demo follows.
2. **Walk the click-path surface by surface** (Career Graph, Leads, Dashboard, tailoring/CV) and ask
   one question per surface: is everything visible wired to real data and a real interaction, or is
   something static/placeholder pretending to be finished? "Unwired UI" is the disqualifying
   condition — Career Graph already passes "the data is correct" and still fails this stricter bar.
3. **Cross-check Process/CI** (via the CI dashboard) for every item whose `ci-area` touches that
   surface. Anything at `0 - Idea` or `1 - Development` is unfinished-but-tracked; classify each as
   *must-finish-before-demo* or *future/park*. Anything the walk surfaces that has no CI item yet is
   a gap in the backlog, not just a gap in the UI — open one.
4. **Record the split as a table** (§2.3) and mirror the boundary into `ROADMAP.md` itself (a
   "demo-readiness cut line" note), so the boundary lives in one place going forward.
5. **Re-run this walk before any external demo** — it's a procedure, not a one-time list.

### 2.2 This pass — findings (2026-08-01)

**A1–C7:** confirmed as the floor. Every pipeline step from capture through CV generation must run
cleanly end to end — this restates P1–P3's existing acceptance criteria in ROADMAP.md, not a new
requirement.

**Career Graph — `/profile?view=meter`**
- Data is correct; two things still make it read as unfinished:
  - No dynamic interaction design — the page is static where a "meter" implies feedback/motion.
    *(Open question for Reggie: what should "dynamic" mean concretely — hover detail, live recompute
    on edit, an animated delta? Needs a one-line spec before this can become a CI.)*
  - No enforced creation workflow. `docs/DATA_MODEL.md`'s own hierarchy is `positions → stars →
    star_actions / star_results / star_competences / star_attributes`, with `responsibilities`
    hanging directly off `positions`. Nothing in the UI today guarantees a new action, competence,
    or attribute gets attached to a star, or a new star to a position, before it saves — so the
    graph can end up with nodes that don't match the data model's own foreign-key chain.
- **Neither has a CI item today** — checked Process/CI for "dynamic interaction," "meter," and any
  creation-workflow gate; no matches. Both are net-new gaps, not something already in flight.

**Leads — `/roleproof/scoring-queue`**
- The `/roleproof` landing page ahead of the scoring queue has no clear job — candidate for removal
  so "Leads" opens directly on the queue.
- The umbrella name "Leads" is right as-is for the tab; it already reads as covering queue +
  applications + archive + not-pursued. The fix is cutting the extra page in front of it, not a
  rename.
- The Map (Profile ↔ Requirements) is mid-build under **`Lead Page as Pipeline Canvas`**
  (`1 - Development`, high priority, already in Process/CI) — this is the gating CI for the tab.
- The **Evidence Picker** is explicitly deferred inside that same CI (§4 item 5: *"deferred to its
  own CI, once real data is flowing through the Map"*) — it doesn't exist as a CI item yet; open one
  once the Map lands, per that note's own sequencing.
- Landing-page removal has no CI item yet either — small, but still an untracked gap.

**Dashboard — `/dashboard`**
- Needs weekly/monthly interaction views; Reggie has SharePoint precedent for the shape (the four
  images pasted into this note on 2026-07-03, below — worth confirming these are the reference in
  question). No CI item exists for this yet — checked, nothing dashboard-specific in the backlog
  beyond incidental mentions.

### 2.3 Must-finish vs. future (the cut line)

| Surface | Must-finish before demo | Future / not blocking |
| --- | --- | --- |
| A1–C7 pipeline | All steps run cleanly, no dead ends | — |
| Career Graph | Dynamic interaction (spec needed); enforced creation workflow (position→star→action chain) | Anything beyond the meter/graph itself |
| Leads | Land on scoring queue directly; finish the Map (`Lead Page as Pipeline Canvas`); then Evidence Picker | Campaigns, automated lead search, target-company monitoring — already explicitly out of scope in ROADMAP.md |
| Dashboard | Weekly/monthly interaction views | Anything beyond that — cost/usage panel already shipped per ROADMAP P4 |

### 2.4 CI items to open (none exist yet)

1. Career Graph — Dynamic Interaction Design *(blocked on Reggie's one-line spec of "dynamic")*
2. Career Graph — Guided Creation Workflow (enforce position→star→action/competence/attribute/result
   FK chain; responsibility→position)
3. Leads — Remove/Collapse `/roleproof` Landing Page into Scoring Queue
4. Dashboard — Weekly/Monthly Interaction Views (SharePoint precedent)

Already tracked, just needs finishing: `Lead Page as Pipeline Canvas` (in Development) → then a new
`Evidence Picker` CI per its own §4 item 5.

## 3. Resources or references

- [[docs/ROADMAP]] — source of truth for phase completion; add the cut-line note here once agreed.
- [[docs/DEMO_RUNBOOK]] — operational definition of "presentable," the click-path this review walks.
- [[docs/DATA_MODEL]] — position→star→action/competence/attribute/result hierarchy behind the Career
  Graph workflow gap.
- [[Lead Page as Pipeline Canvas (B-Phase Reorder + Requirement-Evidence Map)]] — gating CI for the
  Leads tab; Evidence Picker deferral is recorded in its §4.
- [[+ Continuous Improvement Dashboard]] — where the CI items in §2.4 will surface once opened.
- [[++ Continuous Improvement Procedure]] — CI lifecycle rules this note follows.

![[Pasted image 20260703113423.png]]
![[Pasted image 20260703114648.png]]
![[Pasted image 20260703121052.png]]
![[Pasted image 20260703121229.png]]

## 4. Notes / Progress log

**2026-08-01** — Reframed from a standalone "where do I stop" feature note (opened 2026-07-03, left
blank) into a review procedure against `docs/ROADMAP.md`, at Reggie's request. Rationale: the
boundary this note was trying to draw already belongs to ROADMAP.md's phase/acceptance structure;
duplicating it here would create two competing sources of truth. This note now owns the *procedure*
and the *current findings*; ROADMAP.md absorbs the resulting cut line (see its new
"Demo-readiness cut line" section). `ci-status` stays `1 - Development` — the procedure is usable
now, but §2.4's four CI items are still unopened and two of the four findings need Reggie's input
before they're actionable (the "dynamic" spec; confirming the SharePoint screenshots below).

**2026-07-03** — Original draft opened, ~39 min logged, four screenshots pasted, no written content.
