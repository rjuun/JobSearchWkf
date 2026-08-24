---
ci-area: Career Graph
ci-roadmap:
ci-title: Career Graph Visualization & Your Story Restructure
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-05
ci-estimated-time: 4
ci-time-spent: 8.5
pr-source: "[[C4. Transform Evidence into CV Bullets]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[{"name":"Design — mockup iterations","startTime":"2026-08-05T10:00:00.000Z","endTime":"2026-08-05T12:30:00.000Z"},{"name":"Development — BDO analysis, page restructure, live D3 wiring, CI","startTime":"2026-08-05T17:00:00.000Z","endTime":"2026-08-05T20:15:00.000Z"},{"name":"Post-delivery fix — orphan ref matching, legend pilling, ATS stat","startTime":"2026-08-05T22:30:00.000Z","endTime":"2026-08-06T00:05:00.000Z"},{"name":"Skill-evidence shorthand parser, DB-access diagnosis, ATS variants, normalize script","startTime":"2026-08-06T13:15:00.000Z","endTime":"2026-08-06T14:30:00.000Z"}]}
```
---

## 1. What is the problem or opportunity?

The Career Graph — the app's whole evidence store (positions, responsibilities, STAR stories, actions,
results, competences, attributes, skills, CV bullets) — had no visual representation anywhere in the app.
`/profile?view=meter` showed only a numeric 0–100 strength score plus flat list-style section cards; there
was no way to see how the evidence actually connects (which STAR a result belongs to, which stories a
recurring competence spans, what a CV bullet was built from). The reference example the mockup was judged
against is a radial "Career Graph — Node Visualization Concept" the user supplied as a screenshot.

Separately, `/profile/story` (the "Your story" page) was underdeveloped — a through-line/cover-letter/
LinkedIn generator with no visible path showing *how* the evidence behind that story gets built in the
first place. The BDO career-coaching method ("Work Sheets New Placement", 32 sections) is the real-world
process a human consultant runs today to elicit that evidence; none of it was reflected in the app.

Both problems shared a layout constraint: `/profile` (Meter) was already crowded — Identity, six evidence
section cards, an Improve/tips loop, and the strength hero all stacked above the fold — leaving no room to
introduce a graph without moving something else out.

## 2. What would the improvement look like?

*(Written at the level of detail needed to hand this to a fresh Claude Code session with no prior context —
the actual execution order was: mockup → data-relationship agreement → visual-design iteration → BDO
document analysis → page restructuring → live D3 wiring. Re-doing this today, follow the same order.)*

### 2.0 Scope

**In scope (all delivered):**
- An interactive, force-directed Career Graph visualization, first as a static HTML design mockup (to
  agree the model and visual language before touching production code), then ported into a live,
  DB-wired React/D3 component on `/profile?view=meter`.
- A restructure of `/profile` (Meter) down to just the graph + the essentials, moving everything else
  (Identity, evidence section cards, Improve, and — per a later follow-up — the strength hero and "To
  strengthen" gaps) onto `/profile/story`.
- A read of the full BDO Work Sheets New Placement document (all 32 sections) and a proposed grouping of
  its content into one-hour "structured interview" sessions, added as a static outline at the top of
  `/profile/story`.
- Filing/recycling a CI to park the (larger, deferred) idea of turning that outline into an actual guided
  interview flow.

**Explicitly out of scope (do not implement in a re-run):**
- An AI-driven interview agent that conducts the sessions — judged too far-fetched for now; parked in
  [[Your Story - Structure Interview Coach Onboarding]] (status `0 - Idea`), not built here.
- A "Network Mapping" interview session (BDO §23–24) — deliberately dropped from the six groups; the user
  wants this treated as its own chapter elsewhere in the app later, not folded in here.
- Fabricating any relationship the data doesn't actually support — see §2.1's fidelity note on CV Bullets.
- Wiring the Assembled (matrix-first) `/profile` face — untouched; this work only touches the Meter
  (`?view=meter`) face and the Story page.

### 2.1 Data model & relationships (agreed before any visual work)

- Position → STAR, STAR → Action, STAR → Result, Position → Responsibility: all one-to-many. Live-schema
  join key is text-based, not a DB foreign key: `stars.positionRef` / `responsibilities.positionRef` /
  `starActions.starRef` / `starResults.starRef` match the parent's `refCode` (e.g. `"F-R2"`), not its `id`.
- Competences and attributes are recorded per-STAR (`starCompetences.competence`,
  `starAttributes.attribute`, one row per story), but the *same* competence/attribute name often recurs
  across multiple STARs. Dedupe by name (trim + case-insensitive) into one node per unique name, linked to
  every STAR that demonstrates it — same pattern skills already use via `skillsMaster.starEvidence` (an
  array of STAR ref codes).
- Competences, attributes and skills all share one visual size tier ("granular") even though they stay
  distinct node types/colors — CV tailoring treats them as one "skills" language even though the graph
  keeps them separate evidence types (C3 procedure).
- **Ref-code matching must be normalized, not raw-equality.** Every join in this model
  (`stars.positionRef`, `starActions.starRef`, `starResults.starRef`, `responsibilities.positionRef`,
  `starCompetences.starRef`, `starAttributes.starRef`, `skillsMaster.starEvidence`) is a free-text column,
  not a DB foreign key, and hand-entered/workbook-imported ref codes can differ only in case or stray
  whitespace (`"f-r2 "` vs `"F-R2"`). Raw `===`/`Map.get(raw)` silently drops the link and the node renders
  as a false orphan — the evidence exists, the join just missed it. Fix: a shared
  `normRef = (s) => (s ?? '').trim().toUpperCase()` (exported from `lib/career-graph-view-model.ts`) applied
  on **both** sides of every ref-code join and lookup — map-building (`posByRefCode`, `starByRefCode`) and
  map-reading alike, including the `.find(x => x.refCode === ref)` side-panel lookups in
  `career-graph-view.tsx`. Discovered post-delivery: the skill→STAR proposal script
  (`scripts/propose-skill-star-links.ts`) reported zero unlinked skills, yet the rendered graph clearly
  showed multiple orphan clusters — a mismatch only explainable by a matching bug, not missing evidence.
  `scripts/diagnose-career-graph-orphans.ts` (new, report-only) exists to confirm this against real data:
  it separates "recovered by normalized matching" from "still orphan after normalization" (a genuine
  content gap) for every join, then reports actual orphan nodes in the live view-model output.
- **CV Bullets are an overlay layer, not part of the graph's resting shape** — hidden until toggled on in
  the legend. Rendered as rounded-rect chips (`40×20`), deliberately larger than a STAR node so a bullet
  always reads as "bigger than any evidence it's built from".
- **Fidelity note — read before re-implementing:** the design mockup was built directly from
  `Profile_Reference_Workbook.xlsx`, which carries richer columns than the live `lib/db/schema.ts` — a
  separate Situation/Task text per STAR (live schema has one merged `summary`), competence/attribute
  description text (not present live), position seniority/location/notes (not present live), and a
  free-text bullet "Comment" column that let the mockup draw real bullet→evidence-source edges (5 of 28
  bullets in the workbook cited a specific action/result/responsibility/competence/attribute). **None of
  that exists in the live schema.**
  ~~The live component does not fabricate it: a CV Bullet links to a position only when its `cvPosition`
  text case-insensitively matches a position `title` (best-effort, not a stored FK)~~ **— FIXED, see
  `[[Fix CV Bullet Evidence Linking in the Career Graph]]` (delivered 2026-08-06). `cvPosition` actually
  holds a `CV_SLOTS` slot code (`lib/cv-slots.ts`), never a position title, so that title-match had never
  once succeeded on real data. Now: a project-slot bullet (A1, B2, ...) links to its specific STAR via a
  hardcoded, human-confirmed `CV_SLOT_STAR_REF` mapping (built from a live `stars`-table read), and a
  role-overview bullet (A0, B0, ...) links to every Responsibility under that slot letter's position. That
  CI also fixed a second, related bug it found while verifying in-browser: the side panel
  (`career-graph-view.tsx`) re-derived the bullet→position match with its own copy of the old (broken)
  logic instead of reading the view-model's actual link — so even before this fix landed, the graph could
  draw a correct dashed line while the side panel still said "no matching position found". Both now read
  from the same `starByBulletId`/`respByBulletId` maps the view-model computes once.** The bullet→skill
  link (one of its `tags` exactly matching a skill name, inferred from the bracketed C3 tag, not a stored
  source reference) is unaffected and works as originally described. Both are called out in
  the graph's own footnote text (`GRAPH_FOOTNOTE` in `lib/career-graph-view-model.ts`), which the new CI
  will also need to update.
- **STAR `refCode` format is not fixed** — the example above (`"F-R2"`) came from the design mockup's
  source workbook; this live profile's actual STAR `refCode`s are plain numbers (`"1"`–`"7"`, confirmed
  2026-08-06 via direct query). The join code doesn't assume a shape either way — don't hardcode an
  expected format when re-implementing.

### 2.2 Visual design spec (agreed via the mockup, then ported as-is)

- **Node palette** (one fixed color per type, independent of the app's own proof/caution UI colors — needed
  to stay distinguishable across 9 types in a dense graph): position `rgb(30 58 138)` navy, star
  `rgb(13 148 136)` teal (white fill, not tinted), action `rgb(22 163 74)` green, result
  `rgb(234 88 12)` orange, responsibility `rgb(100 116 139)` slate, competence `rgb(124 58 237)` violet,
  attribute `rgb(219 39 119)` pink, skill `rgb(180 83 9)` amber-brown, bullet `rgb(190 18 60)` crimson
  (rect, not circle).
- **Size code** (independent of color, largest → most granular): position `20` → responsibility `6.5` →
  action/result `4.5` → competence/attribute/skill `3` (all three share this tier) → bullet, sized to its
  own `40×20` rect. Shown in the legend as matching-sized swatches plus a caption line stating the rule.
- **Layout physics**: `d3.forceSimulation` with per-type charge (`position: -950` down to
  `competence/attribute/action: -13`), per-edge-pair link distance (`position→star: 78`,
  `position→responsibility: 34`, `star→action: 20` — inner orbit, priority — `star→result: 44` — outer
  orbit — `star→competence`/`star→attribute: 24`), and collision radius padding so hubs don't overlap.
  Actions get the inner orbit around their STAR and Results the outer one (explicit priority call from
  user feedback — Actions and Results were "competing" for the same ring in an earlier iteration).
- **Interaction**: click a node → side panel with its full record and clickable cross-links to
  neighbors; hover → dim everything except the hovered node's neighborhood (skip while something is
  selected); free-text search → dim non-matches; a legend toggle per type (CV Bullets defaults **off**);
  smooth incremental wheel-zoom (`scale *= 1.0018^-deltaY`, eased over 160ms, anchored under the cursor —
  a physical mouse wheel's big notches read as jumpy under d3-zoom's default step handler).
- **Legend grouping ("pilled")**: the 9 per-type toggles are not a flat row — related types sit inside a
  shared pill (`LEGEND_GROUPS` in `career-graph-view.tsx`): `[position]`, `[responsibility]`, `[star]`,
  `[action, result]` (what piles directly under a STAR), `[competence, attribute, skill]` (three distinct
  node types/colors that are meant to read as one "Skills" family for CV-tailoring purposes), `[bullet]`.
  Each type inside a pill keeps its own independent toggle — pilling is a visual grouping cue only, it does
  not collapse the underlying types. Follow-up to the original flat-legend delivery, per explicit user
  instruction that the ask was about grouping, not just left-to-right ordering.
- **"ATS skills" stat tile denominator**: counts Competences and Attributes alongside Skills, since the
  legend now visually groups them as one family — `skillsWithAts / (totalSkills + totalCompetences +
  totalAttributes)`, labeled "ATS skills (+Comp/Attr)". User's explicit choice ("widen the denominator")
  over the alternative of leaving the stat as skills-only and adding a separate note.
- **Auto-fit**: once the simulation settles, frame the currently-*visible* node types only (so the hidden
  CV Bullets overlay never widens the view before it's toggled on), animated on legend toggles and window
  resize.

### 2.3 Page restructuring spec

**`/profile?view=meter` — final shape:** editorial header + view toggle → onboarding front door (only
when the graph is thin/weak) → the live `<CareerGraphView graph={g} />`. Nothing else — Identity, the
evidence section cards, Improve, the strength hero, and "To strengthen" all moved out (the last two moved
in a follow-up pass after the first cut, per the user's own edit — see §4).

**`/profile/story` — final shape, top to bottom:** back-link + Strength meter/Your story tabs → h1 + intro
→ **Structured interviews** card (the six groups, §2.4) → `<StoryView>` (through-line/cover-letter/LinkedIn
generator, untouched) → **Graph strength** hero (score, ceiling/headroom bar, component breakdown,
Positions/Stories/Quantified/Skills tiles) → **To strengthen** gaps box → **Identity** card → the six
evidence section cards (Positions, STAR stories, Skills, Responsibilities, Education, Languages, Bullet
bank) → **Improve** (tips form + list).

### 2.4 Structured interviews spec

Read the full BDO Work Sheets New Placement document (32 sections, all read — not just the table of
contents) and grouped the sections that require eliciting something personal from the job seeker into six
one-hour sessions, static content in `INTERVIEW_GROUPS` (`app/profile/story/page.tsx`):

1. **Foundations & direction** — Expectations & wishes, Your ideal scenario, Your definition of success,
   Values & motives, Likes & dislikes.
2. **Key achievements** — Identify your achievements (13 prompts) → a keyword shortlist of candidate STARs.
3. **STAR collection I** — The STAR method + STAR #1–4.
4. **STAR collection II** — STAR #5–8 (split from Group 3; eight STARs is too much for one session).
5. **Competencies & self-assessment** — Self/external assessment, Competencies (professional, methodical,
   social, leadership) — feeds Competence/Attribute/Skill nodes directly.
6. **Industry & positioning** — Industry affinity, Personal career vision, Overview of professional
   objectives, Ideal position — target-role criteria, feeds job matching rather than the graph itself.

**Excluded** (reference/coaching material, app-generated output, practice exercises, or post-placement
content — not raw evidence to elicit): Action verbs, CV, Cover letter, Elevator pitch, List of target
companies (struck through in the user's own annotation), Fact sheet/Marketing plan ("just an output" per
the user), Job-market readiness checklist, Xing & LinkedIn, Networking advice, Call instructions,
Communication technique, Interview/Interview questions/Questions to ask, Onboarding plan, My new employer.
**Also excluded, on explicit instruction:** Network / Current network — a "Network Mapping" session was
proposed and then dropped; it's to be treated as its own chapter elsewhere in the app later, not folded
into this sequence.

### 2.5 Files touched

- `lib/career-graph-view-model.ts` **(new)** — pure, framework-free transform from `CareerGraph` (Drizzle
  rows) to `{ nodes, links, stats, ...lookup maps }`. No D3 dependency — kept testable in isolation.
- `components/roleproof/career-graph-view.tsx` **(new)** — the live client component: D3 drives the SVG
  imperatively (simulation/drag/zoom/tick), React state drives the chrome (legend, search, tooltip, side
  panel). Side-panel rendering is per-type JSX (`SidePanel`), not `innerHTML`.
- `app/profile/page.tsx` — inserts `<CareerGraphView graph={g} />`; strips out everything that moved to
  Story (see §2.3); `strengthOf(g)` destructure trimmed to just what's still used (`score`, `label`,
  `signals`).
- `app/profile/story/page.tsx` — adds `INTERVIEW_GROUPS` + the Structured interviews card; re-adds
  `SectionCard`/`Peek`/`countBy`/`ComponentBar`/`StatTile` (moved here from `page.tsx`) plus the Graph
  strength hero, To strengthen, Identity, evidence section cards, and Improve, all reading from its own
  `getCareerGraphFor(owner)` + `listTips()` call.
- `package.json` / `package-lock.json` — added `d3@^7.9.0` (dependency) and `@types/d3@^7.4.3` (dev
  dependency). Nothing else changed.
- `docs/design/career-graph-visualization.html` — the design-mockup artifact the live component was ported
  from (built by `build_career_graph.py` against `Profile_Reference_Workbook.xlsx`, iterated over ~7
  rounds of feedback: adding competences/attributes, the relationships table, zoom smoothing, orbit
  priority, a more distinctive palette + hover tooltips, the size-code hierarchy, and the CV Bullets
  overlay). Reference/history only — not served to end users.
- `Process/CI/Your Story - Structure Interview Coach Onboarding.md` — separate CI, recycled from an
  existing note originally scoped for a full AI interview agent; rescoped to park the nearer-term "turn
  the six groups into an actual guided flow" idea. Filed as its own item, not part of this one.
- `scripts/propose-skill-star-links.ts` **(related, built in a separate session — see §4 2026-08-05 note)**
  — a report-only tool addressing a gap this graph surfaces directly: a skill with an empty
  `skillsMaster.starEvidence` renders as an orphan dot with no dashed evidence line to any STAR. Ranks
  candidate STARs per unlinked skill by keyword overlap (skill name/ATS variants vs. each STAR's title +
  actions + results + competences + attributes text), printing the matched terms for a human judgement
  call. Writes nothing unless run with `--apply`, and even then only for a skill with one match clearly
  ahead of the runner-up — everything else is left to place by hand from the Skills page. Run by the user
  post-delivery; reported zero unlinked skills (see §4 post-delivery note — this is what surfaced the
  ref-matching bug, since the graph still showed orphans).
- `scripts/diagnose-career-graph-orphans.ts` **(new, post-delivery)** — report-only diagnostic, no writes.
  Checks every ref-code join for raw-vs-normalized match differences (proves/disproves the formatting-bug
  theory per join, with examples), then runs the real `buildGraphViewModel` and reports actual orphan nodes
  by type. Built to let the user confirm the `normRef` fix against live data rather than take it on faith.
- `[[Fix CV Bullet Evidence Linking in the Career Graph]]` **(new CI, split out 2026-08-06, delivered same
  day)** — the 27 CV Bullet orphans turned out to be a real bug, not a "best-effort match, sometimes
  misses" limitation as originally described below: `cvPosition` is a `CV_SLOTS` slot code, not a position
  title, so the title-matching code in §2.1 below had never actually linked a bullet to anything. Spun out
  as its own CI because it needed a live DB read this session couldn't reach; delivered from a Claude Code
  session with normal DB access. Fixed `lib/career-graph-view-model.ts`'s bullets loop plus a related side
  panel bug it surfaced in-browser (`career-graph-view.tsx` re-derived the match with its own stale copy
  of the old logic) — see that note for the full analysis and its own progress log.

### Acceptance criteria

- [x] `/profile?view=meter` renders a force-directed graph built from `getCareerGraphFor(owner)` — no mock
      or seeded data in the component itself.
- [x] Legend toggles each of the 9 node types independently; CV Bullets defaults to hidden.
- [x] Clicking a node opens a side panel with its full record and clickable links to every direct neighbor;
      hovering dims everything outside that node's neighborhood; the search box dims non-matches.
- [x] `/profile/story` shows, top to bottom: the six-group structured-interview outline, the through-line
      generator, Graph strength + To strengthen, Identity, the six evidence section cards, and Improve.
- [x] `npm run typecheck` passes clean (confirmed locally by the user after the sandbox couldn't complete a
      full run — see §4).
- [x] All ref-code joins use normalized (trim + uppercase) matching, not raw equality, on both the
      map-building and map-lookup side.
- [x] Legend groups Actions+Results and Competences+Attributes+Skills into pills; each type inside a pill
      still toggles independently.
- [x] "ATS skills" stat tile denominator includes Competences and Attributes.
- [x] `scripts/diagnose-career-graph-orphans.ts` run against real data — see §4 2026-08-06 entry.
      `normRef` recovered **zero** rows; the orphans are a data-content issue, not a matching bug. Follow-up
      data cleanup tracked separately, not blocking this CI's `Delivered` status.

## 3. Resources or references

- `docs/design/career-graph-visualization.html` — the interactive mockup (199 nodes / 246 links with the
  CV Bullets toggle on) this component was ported from.
- `BDO_Worksheets_New_Placement.docx` — the 32-section source document for the structured-interview Groups.
- `Meter vs Your Story pages.pdf` — the user's annotated screenshots that specified "insert the artefact
  here", "move everything below to Your Story", and "add a structured-interviews table on Your Story".
- [[Your Story - Structure Interview Coach Onboarding]] — the recycled CI for the deferred guided-interview
  flow.
- [[C4. Transform Evidence into CV Bullets]] — the CV Bullet model context (skill tags, evidence sourcing).
- `docs/ROADMAP.md`, `docs/archive/RoleProof_Rethink_Completion_Milestones.md` — read to answer the
  Assembled-vs-Meter placement question before deciding where the graph would land.
- `lib/career-graph.ts`, `lib/db/schema.ts` — the underlying data model (`CareerGraph` type, Drizzle
  tables) the view-model transform is built against.

## 4. Notes / Progress log

- 2026-08-05 — **Design phase.** Built the interactive HTML mockup from a screenshot request ("introduce
  this visualization on the Meter page"), then iterated through ~7 rounds of user feedback in a single
  extended session: added competences/attributes (initially missing) and moved to a circular layout;
  agreed the Position/STAR/Action/Result/Responsibility/Competence/Attribute/Skill relationship table;
  smoothed the mouse-wheel zoom; gave Actions priority on the inner orbit around STARs with Results one
  ring further out; made the color palette more distinctive and added hover tooltips per a reference
  design; introduced the shared "granular" size tier for competences/attributes/skills plus cross-STAR
  deduping with multi-story links; added CV Bullets as a legend-gated overlay layer with slot + (where the
  data supports it) source-evidence edges. Verification throughout was static-only (`node --check`, JSON/
  HTML-balance checks, Node scripts for dangling-reference and node/link counts) — no headless browser was
  available in the sandbox (`npx playwright install chromium` blocked by network allowlist).
- 2026-08-05 — **Research.** Read `docs/ROADMAP.md` and the Rethink Milestones doc to resolve
  Assembled-vs-Meter; read the full `BDO_Worksheets_New_Placement.docx` (all 32 sections, via
  `pandoc -t markdown`) rather than just its table of contents, to ground the interview-group proposal in
  actual question content, not just section titles.
- 2026-08-05 — **Page restructuring + CI recycle.** Proposed the six structured-interview groups (a
  seventh, "Network Mapping", was cut per explicit instruction — parked as a future standalone chapter).
  Restructured `/profile/page.tsx` and `/profile/story/page.tsx` per §2.3. Found the existing
  `Onboarding — Consultant-Guided Interview Agent` CI covered near-identical ground under a far-future
  "AI robot interviewer" framing the user judged too far-fetched for now; recycled/rescoped that note
  in place (renamed, `§1`/`§2` rewritten, dated `§4` entry added, original framing kept under "Deferred"
  rather than deleted) instead of filing a duplicate.
- 2026-08-05 — **Live D3 wiring.** Added `d3`/`@types/d3`; hit a real environment issue installing them —
  the sandbox's project mount is a FUSE filesystem that fails npm's rename-based package extraction
  (`ENOTEMPTY` on directory replace, reproducible on unrelated pre-existing packages too, not just d3).
  Worked around it by installing cleanly into a scratch directory on real disk, copying the resolved
  packages across, and hand-merging the `package-lock.json` entries (including nesting a second
  `commander@7` under `d3-dsv` since the project's existing top-level `commander@4.1.1`, used by
  `next`/`drizzle-kit`, didn't satisfy `d3-dsv`'s range). One copy pass truncated several `@types/d3-*`
  `.d.ts` files mid-write; caught via a byte-size diff against the scratch source and repaired. Built
  `lib/career-graph-view-model.ts` and `components/roleproof/career-graph-view.tsx` (ported from the
  mockup's vanilla-JS script, adapted to the live Drizzle field names — see §2.1's fidelity note for what
  had to be dropped rather than faked). A full `tsc --noEmit` couldn't complete inside the sandbox's
  per-command time limit on this FUSE mount; verified instead via a scoped incremental `tsc` pass, a
  TypeScript-API syntax-only parse of the four changed/new files (clean), and manual cross-checks against
  `lib/db/schema.ts`. **The user then ran `npm run typecheck` locally and confirmed a clean pass** —
  the authoritative check.
- 2026-08-05 — **User follow-up pass** (applied directly, not by request in-chat): moved the Graph
  strength hero and "To strengthen" gaps box from `/profile` onto `/profile/story` as well (reasoning
  captured in-file: keeps the Meter view focused on the node graph itself, since its compact
  Positions/Stories/Quantified/Skills tiles already cover the at-a-glance need), taking `ComponentBar`/
  `StatTile` with it; reordered the graph's legend (`TYPE_META`) so Responsibilities sits next to
  Positions rather than after the STAR cluster, matching the orbit hierarchy. Reviewed for consistency —
  no leftover duplication or unused imports on either page.
- 2026-08-05 — **Delivered.** Confirmed working end to end (`npm run typecheck` clean, both pages read
  correctly). This CI closes with `ci-status: 3 - Delivered`. Time logged (`ci-time-spent: 5.75`) is
  reconstructed from file-modification timestamps across the session rather than a precise clock log —
  two clusters of activity today, ~10:00–12:30 (design/mockup) and ~17:00–20:15 (research through live
  wiring); real elapsed time includes user think/review time interleaved with the agent's, not pure
  agent-active time. `ci-estimated-time: 4` is what a fresh, focused re-run of just §2 (skipping the
  mockup-iteration and FUSE-debugging discovery paths) should reasonably take.
- 2026-08-05 — **Cross-checked against a report from a separate, concurrent session** (on CV Tailoring /
  requirement-evidence mapping) after the user flagged they may have crossed the two threads. Verified
  against the actual repo state rather than taking the report at face value:
  - **Legend order and the Graph strength hero's position on `/profile/story`** — both already reflected
    exactly as reported; already logged above under "User follow-up pass". No further action.
  - **`scripts/propose-skill-star-links.ts`** — real, present, untracked (`git status`). Its own docstring
    ties it directly to this graph ("a skill node renders as an orphan... with no dashed line" when
    `starEvidence` is empty), so it's cross-referenced in §3/§2.5 above as a related follow-up tool. It was
    *built* in the other session, not this one, and has not been run — noted, not claimed as this CI's own
    work.
  - **The `languages_summary` → `citizenship`/`relocation`/`travel` + `requirement_tailoring.evidenceKind`
    schema change, and the pending `npm run db:generate` → `npm run db:migrate`** — confirmed real
    (`git diff lib/db/schema.ts`, uncommitted; migration `0033_jittery_thunderball.sql` present but doesn't
    yet include the `languages_summary` drop, matching "one more schema change this round" in the other
    session's own note). **This is unrelated to the Career Graph and does not belong in this CI** — it's
    profile-eligibility-facts and requirement-tailoring work, a different feature area, and folding it in
    here would violate the "atomic, independently trackable" rule for CI items. No existing CI in
    `Process/CI` obviously owns it (`Guard C5 Against Empty Tailored Profile` is unrelated — different C5
    profile-text-floor problem). Not actioned here; flagged back to the user rather than guessed at.
- 2026-08-05/06 — **Post-delivery fix: orphan ref matching, legend pilling, ATS stat.** Two genuine
  follow-up items the user had raised in the other session by mistake and asked to finish here (status
  stayed `3 - Delivered`, logged per the "post-implementation reconciliation" convention rather than
  reopening):
  1. **Orphan nodes despite `propose-skill-star-links.ts` reporting zero unlinked skills.** The script
     confirmed no *skill* has an empty `starEvidence`, but the rendered graph still showed several
     disconnected clusters — a mismatch only explainable by the join itself silently failing, not by
     missing evidence. Root-caused (by inspection, not live-DB access — the sandbox has none) to raw
     string-equality ref-code matching, which a case or whitespace difference defeats. Added `normRef`
     (trim + uppercase) to `lib/career-graph-view-model.ts` and applied it to every join: `posByRefCode`/
     `starByRefCode` map construction, all lookup call sites (stars→position, actions→star, results→star,
     responsibilities→position, competence/attribute group dedup, skills' `starEvidence`), and the 8
     `.find(x => x.refCode === ref)` side-panel lookups in `career-graph-view.tsx` (position, star, action,
     result, responsibility, skill cases). Wrote `scripts/diagnose-career-graph-orphans.ts` (report-only)
     so the user can confirm this against real data — per join, how many rows failed raw matching, how many
     were recovered by normalization vs. still genuinely orphaned, plus an actual orphan-node report from
     the real `buildGraphViewModel`. **See the 2026-08-06 correction entry below — the diagnostic ran and
     the hypothesis was disproven.**
  2. **Legend refinement was about grouping, not just sequencing.** The prior "reorder the legend" fix
     (logged under "User follow-up pass" above) only changed left-to-right order. The actual ask, per an
     annotated screenshot: pill Skills/Competences/Attributes together (they're distinct node types/colors
     but should read as one "Skills" family for CV-tailoring purposes) and pill Actions/Results together
     (what piles under a STAR). Added `LEGEND_GROUPS` and a grouped legend render in
     `career-graph-view.tsx` — multi-item groups wrap in a pill container, single-item groups render
     unwrapped, every type keeps its own independent toggle. Also updated the "ATS skills" `MiniStat` per
     the user's explicit choice ("widen the denominator" over the alternative of a skills-only stat plus a
     separate note): now `skillsWithAts / (totalSkills + totalCompetences + totalAttributes)`, label "ATS
     skills (+Comp/Attr)". Required adding `totalCompetences`/`totalAttributes` to
     `GraphViewModel.stats` in the view-model.
  - **Verification**: syntax-only check (`ts.transpileModule`) on all three touched files — clean. A scoped
    `tsc --noEmit` via a temporary `tsconfig.check.json` again could not complete inside the sandbox's
    per-command time limit (same known FUSE-mount limitation as the original delivery); the temp config was
    removed afterward. `git status --short` confirmed only the three intended files changed. As with the
    original delivery, the user's own local `npm run typecheck` is the authoritative check and has not yet
    been re-run against this round's changes.
- 2026-08-06 — **`npm run typecheck` confirmed clean** by the user (screenshot) against this round's three
  changed files.
- 2026-08-06 — **Diagnostic run — hypothesis corrected.** The user ran
  `scripts/diagnose-career-graph-orphans.ts` against real data. Result: **`normRef` recovered zero rows** —
  every ref-code join that failed by raw equality also failed after trim+uppercase normalization. The
  case/whitespace-mismatch theory from the entry above is disproven for this dataset; `normRef` is still
  correct defensive practice (a real formatting mismatch would have been silently dropped exactly as
  described) but it isn't what's causing these orphans. The actual causes, confirmed from the script's own
  output:
  - **3 `skillsMaster` rows are not skills at all** — confirmed by the user directly querying the table
    (screenshot): their `refCode`/`skill` values are the sheet title ("SKILLS MASTER"), a column-definition
    sentence ("Master skills inventory. ATS_Keyword_Variants lists alternative phrasing..."), and the
    column header row itself ("Skill_ID"/"Skill_Name"/...). Header/description rows from the source
    workbook swept in as if they were skill rows. **The user has already deleted these 3 rows.**
  - **`skillsMaster.starEvidence` entries are human-readable shorthand, not clean ref codes** — e.g.
    `"STAR 4"`, `"STARs 1"`, and two aggregate entries, `"All STARs"` and `"All senior STARs"`. The
    live STAR `refCode` values in this profile are plain numbers (`"1"`–`"7"`, confirmed via the user's own
    query of `starCompetences`), so `"STAR 4"` fails to join by exact or normalized match — the mismatch is
    an extra word, not casing. Per the user's own read of the data, most evidence lists only have the
    `"STAR"`/`"STARs"` word on their *first* entry (e.g. `["STARs 1", "2", "5", "7"]`), which is why only
    some skills went fully orphan rather than all of them. Traced to `scripts/seed.ts:307-310`, which
    imports the workbook's evidence column verbatim with no ref-code validation.
  - **1 orphan position** ("Trade Marketing Coordinator") and **27 orphan bullets** are exactly what the
    script's closing note describes: a position with no STARs/responsibilities recorded yet, and CV
    Bullets whose `cvPosition`/`tags` text doesn't happen to match a position title or skill name (the
    known best-effort-matching limitation already documented in `GRAPH_FOOTNOTE`, §2.1). Not bugs.
  - **Not actioned in this CI** — this is data content and (for the placeholder) a minor UX-copy issue, not
    a graph-rendering defect; the graph is correctly rendering these nodes as orphans because they
    genuinely don't have a resolvable link in the underlying data. Flagged back to the user for a decision
    on how to fix the source data/placeholder; out of this CI's scope to guess at without DB write access
    from the sandbox in any case.
- 2026-08-06 — **Skill-evidence shorthand resolved in code (superseding the entry above for skills).**
  Rather than have the user hand-fix 13 skills' evidence fields, added a parser in
  `lib/career-graph-view-model.ts` (exported `resolveStarEvidenceRef` + `seniorStarRefCodesOf`, so a
  later data-cleanup script could reuse the identical rule — see the 2026-08-06 entry further below) so
  the code understands the shorthand the data already uses, instead of requiring the data to change:
  - Strips a leading `"STAR"`/`"STARs"` word before matching (`"STAR 4"` → `"4"`), case-insensitive.
  - `"All STARs"` expands to every STAR ref this owner has — unambiguous, no guessing.
  - `"All senior STARs"` (`SK-23`, Team Leadership & People Development) expands to the STARs under a
    **user-confirmed, explicit list of position titles** — Head of Governance and Strategy, Deputy Head of
    Controlling & IT, Senior Analyst to the Board, Trade Marketing Coordinator — held in
    `SENIOR_POSITION_TITLES`. Not an inference from title text or any schema field (there isn't one); asked
    the user directly rather than guess, consistent with this CI's no-fabrication rule (§2.0).
  - Each skill's resolved STAR links are also captured in a new reverse-lookup map,
    `GraphViewModel.starsBySkillId`, so `career-graph-view.tsx`'s side panel reads from it instead of
    re-deriving from raw `starEvidence` text a second time — one parsing path, not two that could drift.
  - `scripts/diagnose-career-graph-orphans.ts` — added a note on its Part 1 skill-evidence check that it
    predates this parser and will over-report "genuine gaps" for skills; Part 2 (which calls the real
    `buildGraphViewModel`) already reflects the fix and is the authoritative count.
  - The 3 garbage `skillsMaster` rows were in `skillsMaster` itself, not `starCompetences` as guessed in the
    entry above before the user's screenshot corrected it — **user has already deleted them**, no code
    action needed. Live STAR `refCode`s in this profile are plain numbers (`"1"`–`"7"`), not the `"F-R2"`-
    style codes assumed in §2.1's original fidelity note; that note describes the *design-mockup workbook's*
    convention, which doesn't have to match every live profile's actual ref-code values — the join code
    itself is ref-code-format-agnostic and doesn't assume a shape.
  - **Verification**: syntax-only check (`ts.transpileModule`) on the 3 touched files — clean. Full
    `tsc --noEmit` still can't complete in the sandbox (same FUSE-mount limitation, unchanged from every
    prior entry in this log). Not yet confirmed by the user's local `npm run typecheck` or a re-run of the
    diagnostic script — both still outstanding before this can be called fully closed.
  - **Schema alignment (`starEvidence` array → one-row-per-link, matching `starCompetences`/
    `starAttributes`) explicitly declined for now** — user's call: too many higher-priority CIs already
    queued to spend time on what's organizational cosmetics given the parser above already makes the
    current shape work. Not filed as a CI; revisit only if raised again.
- 2026-08-06 — **Fix confirmed; scope clarified as bigger than a graph fix.** The user ran
  `npx tsx scripts/diagnose-career-graph-orphans.ts` again after `resolveStarEvidenceRef` landed and
  confirmed via screenshot: `skills: 0 orphans` (was 13), `20/60` on the ATS-skills tile (from the widened
  denominator, unrelated to this fix), `npm run typecheck` clean. Remaining orphans are the 1 position with
  no evidence yet and 27 CV Bullets (expected — best-effort text-matching limitation, §2.1). The user also
  named the actual stakes of this work explicitly: the Career Graph isn't only an end-of-process
  visualization on `/profile?view=meter` — it's meant to double as the future evidence-picker interaction
  surface for CV tailoring (see `[[Adjustment of Career Graph as Evidence Picker]]`, opened the same day by
  a parallel session, currently `0 - Idea`). Noted here so anyone picking either CI up next understands why
  data fidelity in this graph (accurate joins, no phantom orphans, no silently-fabricated links) matters
  beyond just "the picture looks right" — a future picker will be selecting real evidence through these
  exact nodes.
  - **Sandbox has no DB access — root-caused, not assumed.** The user asked directly why (having received
    an unrelated IP-block notice a few days earlier and offering to unlock it). Tested rather than guessed:
    DNS resolution fails in this sandbox for *any* hostname (`kubos.myds.me` and `google.com` both fail
    identically), and a direct connection attempt to the DB host/port is refused by the sandbox's own
    SOCKS5 egress proxy before it leaves the sandbox. This is a property of this Cowork sandbox's network
    policy, unrelated to the user's router/DDNS — unlocking an IP on their end cannot fix it. Whatever
    triggered their block notice, it did not originate from this session; likely a different, locally-run
    Claude Code session (which would have normal network access) or something unrelated. Documented here
    since it explains why every DB-touching script in this CI (and its predecessors) has to be handed to
    the user to run locally rather than executed directly.
  - **5 ATS-keyword-variant gaps found** (`SK-01`–`SK-05`, all empty arrays) — drafted proposed variants
    in chat, matching the style the other 20 skills already use (acronym + close synonyms). Not written
    anywhere; the user needs to paste whichever they accept into the Skills page. Not a Career Graph defect
    — flagged as a byproduct of reviewing the table for the orphan investigation.
  - **`scripts/normalize-skill-star-evidence.ts` (new)** — user asked, independent of the schema-alignment
    question they'd just declined, to still clean `starEvidence` down to plain ref-code arrays so the
    stored data matches the convention `star_competences`/`star_attributes` already use. Report/`--apply`
    script reusing the exact same `resolveStarEvidenceRef`/`seniorStarRefCodesOf` functions the graph
    itself uses (refactored out of `buildGraphViewModel` into standalone exports for this reason), so the
    stored data and the graph's interpretation of it can't drift apart. Per the user's explicit choice
    (asked, not assumed): `"All STARs"`/`"All senior STARs"` are expanded to a **literal** list of today's
    STAR ref codes rather than kept as an open-ended rule — tradeoff called out to the user before building
    it: a STAR added later won't automatically be covered by `SK-15`/`SK-23` anymore. An entry that doesn't
    resolve to any real STAR (a genuine gap, not shorthand) is left in place rather than dropped. Not yet
    run — the user needs to run it locally (no DB access here, per above), report-only first.
  - **Verification**: syntax-only check (`ts.transpileModule`) on `lib/career-graph-view-model.ts` and the
    new script — clean. Full `tsc --noEmit` unavailable in the sandbox as ever.
- 2026-08-06 — **`skillsMaster.starEvidence` fix confirmed live.** User re-ran
  `scripts/diagnose-career-graph-orphans.ts` after `resolveStarEvidenceRef` landed: `skill: 0 orphans`
  (was 13). `npm run typecheck` clean. This closes the skill-evidence half of the orphan investigation.
- 2026-08-06 — **CV Bullet orphans investigated; split into `[[Fix CV Bullet Evidence Linking in the Career
  Graph]]`.** Same session, following up on the remaining 27 bullet orphans. Real `bullet_bank` data (user
  pasted the export directly) showed `cvPosition` holds `CV_SLOTS` slot codes (`"A1"`, `"B2"`, ...) from
  `lib/cv-slots.ts`, not position titles — meaning the existing `posByTitle.get(norm(b.cvPosition))` match
  in this graph's bullets loop was never going to succeed for any bullet, ever. Not a "sometimes misses"
  best-effort limitation as §2.1 originally described — a real bug. Also surfaced: the garbage row pattern
  seen in `skillsMaster` (§4, earlier entry) recurred in `bullet_bank` too (a column-header row imported as
  data); user deleted it directly. Rather than fix this in place (needs a live `stars`-table read to build
  an exact slot→STAR mapping, which this sandbox cannot reach — see the DB-access entry above), scoped and
  handed off as a fully self-contained, DB-access-required CI for a Claude Code session to execute. Design
  decisions locked in with the user before filing: role-overview bullets (`*0`) link to the position's
  Responsibilities, not the position node; the slot→STAR mapping should be a hardcoded, human-confirmed
  table (mirroring `SENIOR_POSITION_TITLES`), not a runtime fuzzy-keyword matcher — a concrete failure mode
  was identified while scoping (`"Governance Transformation Project"` vs. a STAR titled along the lines of
  "Transforming Governance Process" shares only one token, since "transformation" and "transforming" don't
  match as literal strings).
- 2026-08-06 — **Both outstanding manual items confirmed done** (user screenshot of `skills_master`):
  `scripts/normalize-skill-star-evidence.ts` has been applied — every `star_evidence` value is now a plain
  ref-code array (`["3"]`, `["1","4"]`, `["1","2","3","4","5","6","7"]`, etc.), no `"STAR"`/`"STARs"` text
  remaining. All 25 skills now carry `ats_keyword_variants`, including the 5 that were empty
  (`SK-01`–`SK-05`) — populated with variants matching the ones drafted in chat. This CI, and everything
  that was asked of it, is closed. Only remaining thread is the split-out
  `[[Fix CV Bullet Evidence Linking in the Career Graph]]`, which needs a DB-connected Claude Code session.
