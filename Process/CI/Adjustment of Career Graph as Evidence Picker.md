---
ci-area: Tailoring / Requirement-Evidence Map · Career Graph visualization
ci-roadmap:
ci-title: Adjust the Career Graph visualization to serve as the Evidence Picker
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-08-06
ci-estimated-time: 10
ci-time-spent: 0
pr-source: "[[Make C2 Build on B6 Instead of Re-Deriving the Map]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Start here — this note is self-contained
> Written to be picked up in a **fresh chat with no prior context**. It records an idea, not a design —
> nothing below is a committed plan. The owner's own framing (§1) is the core of it: don't reinvent a
> bespoke picker UI, adapt the interactive Career Graph visualization that already exists.
>
> **Check for parallel work first.** The owner has been developing the Career Graph's interactive
> visualization in a separate, ongoing thread ("Career Graph Visualization") outside this one. Before
> scoping this CI further, find out what that visualization looks like *today* — its component shape,
> its selection/interaction model, whatever's shipped since this note was opened — and re-verify every
> claim below against the current code rather than trusting this snapshot.

---

## 1. What is the problem or opportunity?

**Some evidence in the Requirement → evidence map has nowhere to land on the CV, and there is no way to
place it there.**

`CV_SLOTS` (`lib/cv-slots.ts`) is 11 fixed "Professional Experience" position/project slots. A STAR
action or Responsibility that genuinely supports a requirement but was never given one of those 11 slots
shows up in the Map as blocked — `evidenceNeedsCvSlot()` correctly refuses to approve it without one,
because "approved but literally cannot print" would be a false claim. Today the only way to unblock it is
to edit the row directly in the database. There is no UI for "take this piece of evidence and place it
into a real CV slot."

This gap was named and deliberately deferred twice already:
- `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]` (2026-08-01): *"Evidence
  picker — deferred to its own CI, once real data is flowing through the Map."*
- This conversation (2026-08-05), diagnosing why two Language-kind rows and one STAR-action row stayed
  unapproved even after evidence_kind/cvPosition gating was fixed: the STAR action ("the 'AI' bullet")
  remains blocked not because of a bug, but because nothing lets the owner assign it a slot. Owner's own
  words: *"the 3 evidences not yet linked to a CV Slot is what could be tuned, had we here the Evidence
  Picker to move it to the CV Slot, right?"*

### The owner's direction (2026-08-06)

Don't build a new, bespoke picker component. The Career Graph already has (or is growing, in the parallel
thread) an interactive force-directed visualization — `components/roleproof/career-graph-view.tsx` +
`lib/career-graph-view-model.ts` at the time this note was opened — with node selection, search, and a
legend distinguishing Positions/Responsibilities/STAR stories/Actions/Results/Competences/Attributes/
Skills. **That same interactive view is what should be reused as the Evidence Picker**: land on it from a
blocked row in the Requirement-Evidence Map, select the node that should back the requirement, and either
introduce it (if the requirement has no evidence yet) or swap it in place of a weaker Kept item.

---

## 2. What would the improvement look like?

### 2.0 Scope (provisional — this is an idea, not a spec)

**Likely in scope:**
- A path from a blocked/unslotted row in the Map (`components/roleproof/pipeline-map.tsx`) into the
  Career Graph visualization, carrying context about which requirement is being served.
- A selection action in that visualization that writes back to `requirement_tailoring` — either setting
  `cvPosition` on the existing row (the STAR-action-needs-a-slot case) or creating/replacing a
  `(requirementId, evidenceRef)` link (the "swap this Kept bullet for a different one" case).
- Whatever UI affordance distinguishes "picking a replacement" mode from the visualization's normal
  browse/explore mode, so the two purposes don't collide.

**Explicitly out of scope for this CI:**
- Redesigning the visualization itself — this is about *reusing* it, not building it. If the parallel
  thread's work already covers selection/picking, this CI may shrink to "wire the existing picker into
  the Map" rather than "build a picker."
- The `Overarching Skills` bank-label data question noted in the B6 CI (`O1`'s `cv_position` isn't a real
  CV section) — a data cleanup question, not a picker-UI one.

### 2.1 Open questions for whoever scopes this next

- What does the Career Graph visualization's selection/interaction model actually look like as of
  whenever this is picked up? (See the parallel-work warning above.)
- Introduce vs. swap: does picking a node for an already-Kept requirement replace the existing link
  outright, or propose it alongside for the owner to choose between? CI-034's merge logic
  (`planMerge` in `lib/pipeline/tailoring.ts`) already has a many-ranked-rows-per-requirement model to
  build on.
- Does a manually-placed slot assignment need its own provenance marker (`prov_source` already
  distinguishes `imported`/`coached`/`swapped` — `swapped` may already be the right value for this).
- Should this reachable from the blocked-item state in `ApproveMapCard`
  (`components/roleproof/workspace.tsx`), from the Map directly, or both?

---

## 3. Resources & references

- **Prior deferrals:** `[[B6 Never Receives the Master Bullet Bank (Empty Evidence Lanes in the Map)]]`
  §4 (2026-08-01 entry, "Known limitation... 9 of the 62 links have no lane to render in").
- **Sibling CI:** `[[Make C2 Build on B6 Instead of Re-Deriving the Map]]` — the merge/approval model this
  would write into.
- **Code:** `lib/cv-slots.ts` (`CV_SLOTS`, `evidenceNeedsCvSlot`) · `components/roleproof/pipeline-map.tsx`
  (the Map) · `components/roleproof/career-graph-view.tsx` + `lib/career-graph-view-model.ts` (the
  visualization to reuse — re-verify current shape before scoping) · `lib/pipeline/tailoring.ts`
  (`planMerge`, `ProposedLink`) · `app/actions/tailoring.ts`.
- **Parallel work:** the "Career Graph Visualization" thread — check its current state before starting.

---

## 4. Notes / Progress log

### 2026-08-06 · Opened

Parked as a medium-priority idea per the owner's request, split out of the general "Evidence Picker is
missing" observation made while closing out `[[Make C2 Build on B6 Instead of Re-Deriving the Map]]` and
`[[Complete Required Lists on the Remaining Strict Tool Schemas]]`. Nothing designed or implemented yet.
