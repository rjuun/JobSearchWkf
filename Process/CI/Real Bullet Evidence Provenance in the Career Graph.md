---
ci-area: Career Graph
ci-roadmap:
ci-title: Real Bullet Evidence Provenance in the Career Graph
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-07
ci-estimated-time:
ci-time-spent: 4
pr-source: "[[Fix CV Bullet Evidence Linking in the Career Graph]]"
pr-target: claude/ci-044-bullet-evidence-provenance-ede19c
---

```simple-time-tracker
{"entries":[{"name":"Worktree/DB setup — rebase onto main after discovering CI-040 was Delivered but unmerged","startTime":"2026-08-08T08:00:00.000Z","endTime":"2026-08-08T08:20:00.000Z"},{"name":"Schema: bullet_evidence junction table + migration + DATA_MODEL.md","startTime":"2026-08-08T08:20:00.000Z","endTime":"2026-08-08T08:50:00.000Z"},{"name":"Wire bulletEvidence into CareerGraph type/query; rewire career-graph-view-model.ts bullets loop (confirmed-evidence-first, slot-fallback-second)","startTime":"2026-08-08T08:50:00.000Z","endTime":"2026-08-08T09:45:00.000Z"},{"name":"career-graph-view.tsx: bullet-evidence link kind, styling, side panel","startTime":"2026-08-08T09:45:00.000Z","endTime":"2026-08-08T10:10:00.000Z"},{"name":"Backfill: propose-bullet-evidence-links.ts (report + human-confirmed --apply-file, no auto-apply)","startTime":"2026-08-08T10:10:00.000Z","endTime":"2026-08-08T10:40:00.000Z"},{"name":"Backfill review with owner + apply confirmed mapping (25/28 bullets, 33 rows)","startTime":"2026-08-08T10:40:00.000Z","endTime":"2026-08-08T11:00:00.000Z"},{"name":"Verification — typecheck, vitest, live browser click-through (confirmed + fallback states)","startTime":"2026-08-08T11:00:00.000Z","endTime":"2026-08-08T11:20:00.000Z"},{"name":"Diagnosed \"looks like bullets connect to stars\" — DOM/data inspection proved the link data was right, isolated the real cause (tight force layout, no isolate mode)","startTime":"2026-08-08T11:20:00.000Z","endTime":"2026-08-08T11:45:00.000Z"},{"name":"Implemented CI-037's original isolate-mode legend spec, caught and fixed the incidental-structural-edge leak, verified live (208→37 links)","startTime":"2026-08-08T11:45:00.000Z","endTime":"2026-08-08T12:20:00.000Z"}]}
```
---

## 1. What is the problem or opportunity?

`[[Fix CV Bullet Evidence Linking in the Career Graph]]` (CI-040, delivered 2026-08-06) fixed a real bug —
CV Bullets were checking `cvPosition` against a position *title* instead of a `CV_SLOTS` slot code, so the
match had never once succeeded. The fix (`CV_SLOT_STAR_REF`, a hardcoded slot→STAR map) made every bullet
link to something real: a project-slot bullet (A1, B2, ...) now draws a dashed line to the STAR that owns
that slot; a role-overview bullet (A0, B0, ...) draws to its position's Responsibilities.

**That fix answers the wrong question at the wrong granularity.** `CV_SLOT_STAR_REF` answers "which STAR
does slot A1 belong to" — a per-*slot* inference, good enough to stop bullets linking to nothing, but not
what the graph actually needs to show. The real, useful question is per-*bullet*: which exact evidence row
— a specific `star_action`, `star_result`, `responsibility`, `star_competence`, `star_attribute`, or
`skills_master` entry — was *this* bullet actually written from? Right now every bullet filed under A1
draws to the *same* STAR node, regardless of which specific action or result it was really built from — the
graph can't tell the difference because `bullet_bank` has never recorded where a bullet's text actually came
from. This is the difference between "the graph is honest about what it can show" (CI-040, delivered) and
"the graph shows the right thing" (this CI, not yet started).

This is also the foundation `[[Adjustment of Career Graph as Evidence Picker]]` needs: a picker that lets
someone see and swap the exact evidence backing a CV line requires that link to exist as real data, not be
inferred from which slot the bullet happens to render in.

**Confirmed empirically, not assumed**: a bullet is not always built from exactly one evidence row. Checked
the owner's real `bullet_bank` against every `star_action`/`star_result`/`responsibility`/`star_competence`/
`star_attribute`/`skills_master` row via a shared-phrase heuristic (not a claim of proof, just a signal).
Most bullets have one dominant match, but several look like genuine merges — clearest is `C1`:

> "Designed and implemented an Accounting Correction Layer using a segregated Postgres staging scheme and
> sequenced queries..."

— which scores almost equally against **three separate** `star_actions`: mapping the As-Is process
(`3-1`), building the Postgres staging schema (`3-2`), and sequencing the correction queries (`3-4`). It
reads as one narrative bullet stitched together from three pieces of evidence, not a rewrite of one. `C6`,
`P2`, and `S4` show the same pattern less starkly. **A single evidence pointer per bullet will not be
enough — this needs a real one-to-many relationship, not two flat columns on `bullet_bank`.**

## 2. What would the improvement look like?

Not fully scoped — this is a handoff to a fresh session, not a plan to execute here. What's already decided
and shouldn't need re-litigating:

### 2.1 Schema: a junction table, not flat columns

The owner's original proposal was two new columns directly on `bullet_bank` — `bullet_evidence_table` /
`bullet_evidence_key` (a polymorphic pointer, same shape `requirementTailoring.evidenceKind`/`evidenceRef`
already uses one level downstream, in the tailoring pipeline). The §1 finding means that should become a
**separate table**, one row per (bullet, evidence) pair — the same "many-to-many by design" pattern
`requirement_evidence` already uses elsewhere in this schema (`docs/DATA_MODEL.md`: "one requirement is
routinely carried by several bullets"). Proposed shape, not final:

```ts
export const bulletEvidence = pgTable('bullet_evidence', {
  ...base,
  bulletId: uuid('bullet_id').notNull(),       // -> bullet_bank.id
  evidenceTable: text('evidence_table'),        // 'responsibilities' | 'stars' | 'star_actions' |
                                                 // 'star_results' | 'star_competences' |
                                                 // 'star_attributes' | 'skills_master'
  evidenceKey: text('evidence_key'),            // the ref_code within that table
});
```

This is deliberately additive — it does not replace `bulletBank.cvPosition`/`CV_SLOTS`, which answers a
different question (**where** a bullet renders on the CV) from `bullet_evidence` (**what** it was built
from). Both stay; neither implies the other.

### 2.2 Backfill — the real work, and a judgment call on how

~27 real bullets need their actual evidence source(s) determined. Two ways to do this, not decided:

- **Manual** — the owner reviews each bullet against its candidate evidence rows and confirms.
- **LLM-assisted proposal, human-confirmed** — a script in the shape of the existing
  `scripts/propose-skill-star-links.ts` (ranks candidates, prints matched terms, writes nothing without
  `--apply`, never auto-applies a low-confidence guess) could rank each bullet's most likely evidence
  row(s) using the same real data this CI's own investigation script used, but a human still confirms —
  this is provenance data, not a best-effort inference the graph should render on faith.

Whichever path, the §1 heuristic script (see §3) is a reasonable starting point for candidate ranking, not
a finished answer — it's a shared-phrase heatmap, not semantic understanding, and multi-source bullets
especially need a human eye (a bullet with three roughly-equal-scoring candidates is a genuine merge, but
so is a bullet with three roughly-equal *wrong* candidates the heuristic couldn't distinguish).

### 2.3 Rewire the Career Graph

`lib/career-graph-view-model.ts`'s bullets loop currently draws `bullet-slot` links via `CV_SLOT_STAR_REF`/
`CV_SLOT_LETTER_POSITION` (CI-040). Once `bullet_evidence` exists and is populated, the graph should draw
its dashed evidence lines from the real per-bullet rows instead — to the exact action/result/responsibility/
competence/attribute/skill each bullet actually cites, not the slot's inferred STAR. Whether `CV_SLOT_
STAR_REF` stays (it may still be useful as a fallback for any bullet with no confirmed `bullet_evidence` row
yet — "no confirmed source" is a more honest graph state than "wrong source," so decide the fallback
behavior deliberately, not by default) is an open design question for whoever picks this up.

### 2.4 The data model, illustrated

The owner's own hand-drawn diagram named the relationships this CI is built on; the diagram below is the
same model, redrawn to show where the new piece (`bullet_evidence`, dashed) sits relative to what already
exists (solid):

```mermaid
flowchart LR
    Position["positions<br/>(A, B, C, D)"]
    Responsibility["responsibilities<br/>position_ref"]
    Star["stars<br/>position_ref"]
    Action["star_actions<br/>star_ref"]
    Result["star_results<br/>star_ref"]
    Competence["star_competences<br/>star_ref"]
    Attribute["star_attributes<br/>star_ref"]
    Skill["skills_master<br/>star_evidence[]"]
    Bullet["bullet_bank<br/>cv_position = slot code"]
    BulletEvidence["bullet_evidence (NEW)<br/>bullet_id, evidence_table, evidence_key<br/>— one bullet, many rows"]

    Position -->|1:many| Responsibility
    Position -->|1:many| Star
    Star -->|1:many| Action
    Star -->|1:many| Result
    Star -->|1:many| Competence
    Star -->|1:many| Attribute
    Star -.->|star_evidence text, parsed| Skill

    Bullet ==>|"cv_position — WHERE it renders (existing, unchanged)"| Position

    Bullet -->|"1:many — WHAT it was built from (NEW)"| BulletEvidence
    BulletEvidence -.-> Action
    BulletEvidence -.-> Result
    BulletEvidence -.-> Responsibility
    BulletEvidence -.-> Competence
    BulletEvidence -.-> Attribute
    BulletEvidence -.-> Skill
```

The thick `==>` edge is the relationship CI-040 already wired correctly (a bullet's CV_SLOTS placement).
The `bullet_evidence` node and its dashed edges are what this CI adds — note it can point at *any* of the
six evidence kinds, and a real bullet (§1) can need more than one such edge.

## 3. Resources or references

- `[[Fix CV Bullet Evidence Linking in the Career Graph]]` — CI-040, the slot-level fix this supersedes in
  spirit but not in fact (both relationships are real and both stay).
- `[[Adjustment of Career Graph as Evidence Picker]]` — the feature this data actually serves; a picker
  needs real per-bullet provenance to select/swap evidence against, not a slot-level inference.
- `lib/career-graph-view-model.ts` — the bullets loop to rewire once `bullet_evidence` exists.
- `lib/db/schema.ts` — `requirement_evidence` for the existing many-to-many precedent; `bullet_bank` is
  where `bullet_evidence` would attach.
- `scripts/propose-skill-star-links.ts` — the shape a human-confirmed proposal script should follow if that
  path is chosen for the backfill.
- `docs/DATA_MODEL.md` — the "many-to-many by design" rationale already written down for
  `requirement_evidence`; the same logic applies here.

## 4. Notes / Progress log

### 2026-08-07 · Opened as a handoff

Surfaced when the owner, reviewing CI-040 and CI-039 after both were marked Delivered, produced a hand-drawn
data-model diagram of the Career Graph and asked directly whether the current CV Bullet visualization was
adequate. It isn't — CI-040 fixed a real bug but at the slot level, not the bullet level. The owner's own
proposed `bullet_evidence_table`/`bullet_evidence_key` columns were checked against real data before being
written up here: confirmed the underlying idea is right, but the shape needs to be a one-to-many junction
table, not two flat columns, because real bullets (at least `C1`, and less starkly `C6`/`P2`/`S4`) appear
built from more than one evidence row. Deliberately not implemented in the session that opened this CI —
handed off fresh to preserve context budget for the actual schema/backfill/rewiring work.

**Model recommendation for the implementing session**: mixed. The schema migration and the
`career-graph-view-model.ts` rewiring are mechanical, well-specified changes — **Sonnet 5** is the right
tier for those, same as CI-040 and CI-039 both used throughout. The backfill (§2.2) is the part that
actually needs judgment: distinguishing "this bullet merges three evidence rows" from "this bullet loosely
echoes three rows but was really written from one" is exactly the kind of nuanced, stakes-bearing call
Truthfulness-critical work in this codebase already reserves for **Opus** (same tier C5's profile-writing
step uses, per its own comment: "Truthfulness-critical (Master Instructions §6.1) → Opus tier") — this is
provenance data a future Evidence Picker will treat as ground truth, so a wrong confident guess here is
worse than a flagged uncertain one. If the backfill goes the LLM-assisted-proposal route (§2.2), the
proposal-ranking step should run on Opus even if the surrounding script logic doesn't need it.

### 2026-08-08 · Development started

CI-040's commits had been "Delivered" per its own CI doc but were only merged into `main` today — this
worktree was rebased onto the merged `main` before starting so `CV_SLOT_STAR_REF`/`CV_SLOT_LETTER_POSITION`
and the slot-aware bullets loop actually exist as the base to build on.

### 2026-08-08 · Delivered

Built exactly to the §2 shape, ran on Sonnet 5 throughout (including the backfill judgment call — done as an
interactive review with the owner rather than an unattended Opus pass, which satisfies the same "human
confirms" bar §2.2 asked for):

- **Schema** — `bullet_evidence` (`lib/db/schema.ts`), a junction table (`bulletId`, `evidenceTable`,
  `evidenceKey` + `...prov` so a row's own `source`/`confidence` record how the *link* was established, not
  just the evidence it points at). Migration `drizzle/0036_fearless_hobgoblin.sql`, applied. `docs/DATA_MODEL.md`
  updated with the same "many-to-many by design" framing `requirement_evidence` already carries.
- **Rewiring** (`lib/career-graph-view-model.ts`) — the bullets loop now checks `bullet_evidence` first: any
  bullet with ≥1 confirmed row draws a solid `bullet-evidence` link to each exact node (action/result/
  responsibility/competence/attribute/skill/star), possibly several. A bullet with zero confirmed rows falls
  back to CI-040's `CV_SLOT_STAR_REF`/responsibilities-rollup logic exactly as before (now visually
  distinguished — solid+full-opacity for confirmed, faded+dashed for the slot guess). A bullet with a
  confirmed-but-unresolvable ref (dangling ref_code) deliberately does NOT fall back — a broken confirmed
  ref is a data bug to surface, not paper over.
- **UI** (`components/roleproof/career-graph-view.tsx`) — new `bullet-evidence` link kind + styling, side
  panel now reads `vm.evidenceNodesByBulletId` first ("Built from N confirmed evidence rows: …") and only
  shows the old slot-guess text when that's empty. `GRAPH_FOOTNOTE` rewritten to describe all three bullet
  link kinds (confirmed / slot-fallback / tag-match) so the UI stays honest about which is which.
- **Backfill** — `scripts/propose-bullet-evidence-links.ts`, shaped like `propose-skill-star-links.ts` but
  stricter: no score-threshold auto-apply at all (this data is meant as ground truth, §2.2's own bar).
  Report-only by default; a `--apply-file <json>` flag writes only what a human hand-confirmed, validates
  every ref_code against the live tables first (a typo fails loudly, nothing partial gets written), and
  replaces a bullet's rows wholesale so a correction is just re-running with an edited file.
- **Applied**: ran the proposal script against all 28 real bullets, cross-checked candidates against full
  row text (not just the heuristic's top score — e.g. confirmed `C1`'s three-way merge from the ticket's own
  §1 finding against the actual `star_actions` text, and caught `C4`'s second source, `star_results:4-R2`,
  by checking the €1M figure directly against DB rows the heuristic hadn't surfaced in its top 5). Reviewed
  the full 28-bullet mapping with the owner before writing anything; applied 25 bullets / 33 rows. Left
  `C3` and `C6` unconfirmed (heuristic signal too weak to call confidently — genuine manual-read candidates,
  `C6` is exactly the "less starkly" multi-source case §1 flagged) and `O1` permanently unlinked (it's the
  meta "AI-assisted workflow" bullet — not derived from career evidence, so "no source" is correct, not a
  gap).
- **Verified live**, not just green tests: typecheck clean, `npx vitest run` green (209/209 relevant tests;
  3 unrelated failures are a pre-existing `.storage/jd-captures` fixture gap in this worktree, nothing to do
  with this change). Loaded `/profile?view=meter` in a real browser, toggled CV Bullets on, and confirmed the
  rendered SVG has exactly 33 solid `bullet-evidence` links (matching the 33 rows written) and exactly 2
  faded `bullet-slot` fallback links (`C3`/`C6` — `O1` correctly has neither, no CV slot to fall back to).
  Clicked through to both a confirmed bullet (`C1` → "Built from 3 confirmed evidence rows", the three
  `star_actions` texts) and a fallback bullet (`C3` → "No confirmed source yet — best guess from its CV
  slot") and read the side panel text directly off the live DOM.

**Open, deliberately not blocking delivery**: `C3`/`C6` still need a manual (or fresh-session) read to
confirm their evidence — they correctly render as "no confirmed source yet" in the meantime, which is the
honest state this CI exists to make possible, not a bug.

### 2026-08-08 · Isolate-mode legend fix (CI-037's original design)

The owner flagged that CV Bullets, once toggled on, looked like every bullet just connected to its STAR —
correct suspicion of messiness, but the underlying data was right (confirmed by direct DOM/data inspection:
the link's actual `source` node was the specific `action`/`result`/`responsibility`, not the star; selecting
a bullet already dimmed the star to 0.12 opacity while keeping the true evidence node lit). The real gap was
CI-037's original spec for this overlay, never implemented: bullets should stay hidden until the legend is
clicked (already true), AND once clicked, the graph should show ONLY bullets and their direct connections —
not bullets dropped on top of the full always-on hierarchy.

Implemented in `components/roleproof/career-graph-view.tsx`: a `bulletConnectedIds` set (every node touched
by a `bullet-evidence`/`bullet-slot`/`bullet-tag` edge) gates node visibility whenever CV Bullets is on, and
link visibility is additionally restricted to those three bullet-kind edges only — not just "both endpoints
happen to be visible," which the first pass got wrong: two nodes each visible because of *different* bullets
could still share an incidental structural `contains` edge, and showing that edge would misread as a bullet
connection that doesn't exist. Verified live: toggling CV Bullets on collapses the graph from 208 visible
links (full hierarchy) to exactly 37 — the exact count of bullet-kind edges (33 evidence + 2 slot fallback +
2 tag) — and toggling back off restores the original 208 exactly. Positions and Attributes disappear
entirely in bullet mode (no bullet cites either type directly), which is correct, not a bug.
