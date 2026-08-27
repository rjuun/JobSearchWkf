---
ci-area: Career Graph
ci-roadmap:
ci-title: Fix CV Bullet evidence linking in the Career Graph (CV_SLOTS-based)
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-06
ci-estimated-time: 2
ci-time-spent: 1.5
pr-source: "[[Career Graph Visualization & Your Story Restructure]]"
pr-target: claude/cv-bullet-evidence-linking-73574e
---

---
```simple-time-tracker
{"entries":[{"name":"Worktree setup & DB access recovery (missing files, missing .env.local, rebase)","startTime":"2026-08-06T14:00:00.000Z","endTime":"2026-08-06T14:15:00.000Z"},{"name":"Query live stars/positions/responsibilities; build CV_SLOT_STAR_REF + CV_SLOT_LETTER_POSITION","startTime":"2026-08-06T14:15:00.000Z","endTime":"2026-08-06T14:30:00.000Z"},{"name":"Rewrite the bullets loop in career-graph-view-model.ts","startTime":"2026-08-06T14:30:00.000Z","endTime":"2026-08-06T14:55:00.000Z"},{"name":"Find & fix the side-panel stale-match bug in career-graph-view.tsx","startTime":"2026-08-06T14:55:00.000Z","endTime":"2026-08-06T15:15:00.000Z"},{"name":"Verification — diagnostic script, typecheck, tests, live browser check","startTime":"2026-08-06T15:15:00.000Z","endTime":"2026-08-06T15:30:00.000Z"}]}
```
---

> [!IMPORTANT] Requires DB access — run this from Claude Code, not a sandboxed session
> This note was scoped in a Cowork session with no network path to the database (confirmed by testing,
> not assumed — DNS resolution fails for any host in that sandbox, not just this one). Everything below
> needs a live query against the real `stars` table before anything gets hardcoded. Run this from a
> Claude Code session on the machine with normal LAN/internet access to `kubos.myds.me`.

---

## 1. What is the problem or opportunity?

**CV Bullet nodes in the Career Graph have never linked to a position or STAR — not because the evidence
is missing, but because the matching code checks the wrong thing.**

`lib/career-graph-view-model.ts`'s bullet-linking code (as of 2026-08-06):

```ts
const posByTitle = new Map(g.positions.filter((p) => p.title).map((p) => [norm(p.title), p]));
...
const matchedPos = b.cvPosition ? posByTitle.get(norm(b.cvPosition)) : undefined;
if (matchedPos) links.push({ source: `pos-${matchedPos.id}`, target: id, kind: 'bullet-slot' });
```

This compares `bulletBank.cvPosition` against a position's **title** text (e.g. `"Head of Governance and
Strategy"`). But `cvPosition` doesn't hold a title — it holds a **CV slot code** from `lib/cv-slots.ts`'s
`CV_SLOTS` list: `"A0"`, `"A1"`, `"B2"`, `"D1"`, etc., each one meaning a specific, named project slot in
the "Professional Experience" section (e.g. `"Professional Experience - B1. Accounting Correction Layer
Project"`). No position title will ever equal `"A1"`, so this match has silently failed for every bullet in
the profile since it was built. Confirmed via `scripts/diagnose-career-graph-orphans.ts`: `bullet: 27
orphans` (of 28 rows — the 28th was a garbage header row, since deleted directly by the user).

This was mis-scoped in the original CI (`[[Career Graph Visualization & Your Story Restructure]]`, §2.1)
as "best-effort text match, not stored FK — expected to sometimes miss." It doesn't sometimes miss. It
always misses, on every real bullet, because `cvPosition`'s actual meaning was never checked against
`lib/cv-slots.ts` before the matching code was written.

### Why this matters beyond "the picture is more complete"

Per the user, directly: the Career Graph isn't only an end-of-process visualization — it's meant to double
as the interaction surface for a future evidence picker (see `[[Adjustment of Career Graph as Evidence
Picker]]`, currently `0 - Idea`). A picker built on top of this graph will be selecting real evidence
through these bullet nodes. Getting the bullet↔evidence links right now, with real data, matters more here
than it would for a purely cosmetic visualization.

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:**
- Fix `lib/career-graph-view-model.ts`'s bullet-linking logic to interpret `cvPosition` as a CV slot code
  (via `normalizeCvPosition`/`slotCode` from `lib/cv-slots.ts`), not as free text matched against a
  position title.
- Link each project-slot bullet (`A1`, `A2`, `A3`, `B1`, `B2`, `C1`, `D1`) to its specific STAR.
- Link each role-overview bullet (`A0`, `B0`, `C0`, `D0`) to **every Responsibility row under that slot
  letter's position** — confirmed directly by the user, not the position node itself. If that position has
  no Responsibilities recorded, the bullet correctly gets no slot-link (an honest gap, not an error).
- Derive each slot letter's position from the **STAR's own `positionRef`**, once the letter's project
  STAR is identified — never from the bullet's own ref-code prefix (`G`/`C`/`S`/`P` — a coincidental,
  unverified pattern noticed in chat, not a stored rule) and never from the rendered graph's visual layout
  (force-directed proximity isn't proof of a real link).
- Update the module docstring and `GRAPH_FOOTNOTE` in `lib/career-graph-view-model.ts`, both of which
  currently describe the old (wrong) "text-matches a position title" behavior.
- Update §2.1 and §2.5 of `[[Career Graph Visualization & Your Story Restructure]]` once this lands, so
  that CI stops describing bullet-linking as "best-effort, sometimes misses" when the real story is "was
  simply broken, now fixed."

**Explicitly out of scope:**
- Any picker UI/interaction for assigning or swapping evidence — that's
  `[[Adjustment of Career Graph as Evidence Picker]]`. This CI only fixes what the existing read-only graph
  *renders*, it adds no new interaction.
- `requirement_tailoring`/`requirement_evidence`'s own handling of `cvPosition` — those already correctly
  treat it as a slot code via `lib/cv-slots.ts` elsewhere in the pipeline. This bug is isolated to the
  Career Graph's view-model; nowhere else needs touching.
- Re-deriving `stars.positionRef`/`responsibilities.positionRef` — already confirmed 100% correct via
  `scripts/diagnose-career-graph-orphans.ts` (no ref-matching issue here, unlike the skill-evidence fix).
- `O1` ("Overarching Skills") — a meta-bullet about AI-workflow skills, not tied to any position/STAR.
  `normalizeCvPosition("Overarching Skills")` returns `null` (not a real `CV_SLOTS` entry), so it falls
  through to "no slot link" with no special-case code needed. Leave it that way.

### 2.1 Current state — re-verify fresh, don't trust this summary

This section reflects what was known from a Cowork session with no DB access, working from screenshots and
pasted CSVs the user provided directly. **Confirm all of it against the live DB before building anything
on top of it** — that's the whole reason this CI exists rather than just being implemented in that session.

**`lib/cv-slots.ts`** (unchanged by this CI, just consumed correctly for the first time):

```ts
export const CV_SLOTS = [
  'Professional Experience - A0. Role Overview',
  'Professional Experience - A1. Outsourcing Framework Project',
  'Professional Experience - A2. Governance Transformation Project',
  'Professional Experience - A3. BBAG Wind Down Project',
  'Professional Experience - B0. Role Overview',
  'Professional Experience - B1. Accounting Correction Layer Project',
  'Professional Experience - B2. Transfer Pricing',
  'Professional Experience - C0. Role Overview',
  'Professional Experience - C1. BBSA Merger Project',
  'Professional Experience - D0. Role Overview',
  'Professional Experience - D1. Servicing Center Project',
] as const;
// slotCode(slot) extracts "A1" etc. via /[A-D][0-9]/
// normalizeCvPosition(value) accepts either a bare code ("A1") or the full string, returns
// the canonical CV_SLOTS entry or null if unrecognized.
```

**Real `bullet_bank` data** (owner's export, 2026-08-06 — the header/garbage row originally at the top,
`ref_code="ID"`, has since been deleted by the user directly in the DB; not reproduced below):

```csv
"ref_code","text","tags","cv_position"
L2,"Led the strategic transformation of the Governance function by restructuring the department, shifting administrative and secretarial responsibilities to Human Resources, and hiring targeted analytical capabilities, thereby evolving a traditional secretarial unit into a strategic Governance & Strategy advisory function supporting the Management Board and Supervisory Board.","[""Department Transformation"", ""Organizational Restructuring"", ""Hiring"", ""Strategic Leadership"", ""Governance""]",A0
G10,"Facilitated cross-country co-development workshops uniting the Administrative Departments of Austria, Portugal, France, and Italy to agree on a single Procurement and Outsourcing Procedure.","[""Workshop Facilitation"", ""Cross-Functional Alignment""]",A1
G7,"Designed and rolled out an enterprise-wide Outsourcing Framework covering the full end-to-end Procurement, Outsourcing, and Contract Management lifecycle, eliminating regional process variants and establishing consistent governance across six European countries.","[""Process Harmonization"", ""Outsourcing Governance""]",A1
G8,"Led the implementation of the iValua system to centralize all Outsourcing and Transfer Pricing contracts, delivering improved data integrity, governance controls, and reporting efficiency across the organization.","[""System Implementation"", ""Process Efficiency""]",A1
G9,"Unified Procurement and Outsourcing procedures across the Administrative Departments in Austria, Portugal, France, and Italy, driving standardization and reducing operational complexity through cross-functional alignment.","[""Cross-Functional Alignment"", ""Process Standardization""]",A1
G4,"Spearheaded the design and implementation of an enterprise Governance System using Microsoft SharePoint and Power Automate, replacing fragmented processes with a standardized, auditable framework that improved decision-making speed and transparency across the bank.","[""Process Governance"", ""System Building""]",A2
G5,"Led a collaborative review of the Levels of Authority with Heads of Department and the Management Board, delivering clear recommendations that strengthened governance controls, clarified decision rights, and improved organizational accountability.","[""Governance Improvement"", ""Stakeholder Alignment""]",A2
G6,"Introduced electronic signatures across key governance processes, accelerating approval workflows while ensuring compliance with EBA Guidelines on Governance.","[""Process Efficiency"", ""Regulatory Compliance""]",A2
G11,"Developed and delivered a Governance Onboarding programme for newly appointed Supervisory Board members, producing a full documentation package and leading introductory executive walkthroughs of the digital governance processes, decision flows, Levels of Authority, and bank-specific governance rituals and protocols.","[""Governance Onboarding"", ""Executive Training"", ""Knowledge Transfer"", ""Stakeholder Engagement"", ""Documentation Management"", ""Process Adoption""]",A2
G1,"Co-led the design and execution of a multi-year Wind Down programme by developing the Project Plan and Budget with input from 10 department heads, ensuring regulatory, operational, legal, and financial closure under tight shareholder deadlines and Supervisory Board oversight.","[""Cross-Functional Leadership"", ""Strategic Execution""]",A3
G2,"Prepared and presented formal resolutions to the Supervisory Board for approval of the Wind Down Plan and Budget, providing clear analysis, risk assessment, and recommendations to support critical governance decisions.","[""Board Reporting"", ""Executive Communication""]",A3
G3,"Acted as a trusted mediator and advisor during escalated conflicts between the Management Board and department heads in a politically sensitive environment, maintaining neutrality and enabling progress despite significant internal resistance and external pressure.","[""Conflict Mediation"", ""Strategic Judgment""]",A3
L1,"Built the Controlling function from the ground up as part of the newly established Head Office by hiring and integrating two Controlling Analysts, while simultaneously designing and implementing an automated Accounting Correction Layer and performance dashboards that reduced the month-end close from 20 days to 5 days.","[""Team Building"", ""Controlling Function Setup"", ""Process Transformation"", ""Leadership""]",B0
C1,"Designed and implemented an Accounting Correction Layer using a segregated Postgres staging scheme and sequenced queries, transforming fragmented manual processes into an automated, scalable solution that reduced the month-end close from 20 days to 5 days.","[""Process Transformation"", ""Operational Excellence""]",B1
C2,"Built automated Spotfire dashboards connected to clean, stable data from the Accounting Correction Layer, enabling dynamic performance vs projection analytics and data-driven decision-making across the organization.","[""Data Reliability"", ""Analytical Excellence""]",B1
C3,"Established scalable accounting operations processes through structured data staging and exception management workflows, laying the foundation for greater automation and process reliability.","[""Process Design"", ""Scalability""]",B1
C4,"Developed and implemented OECD-aligned Transfer Pricing Master File documentation for the European group, establishing robust governance, audit-ready files, and delivering approximately €1 million per year in tax efficiency.","[""Transfer Pricing Governance"", ""Tax Efficiency""]",B2
C5,"Partnered with senior stakeholders across multiple European entities to design and review Service Level and Cost-Sharing arrangements, significantly increasing cost transparency and ultimately reducing IT expenditures by nearly 50%.","[""Stakeholder Management"", ""Cost Optimization""]",B2
C6,"Coordinated the alignment of transfer pricing methodologies and cost allocation frameworks across different legal entities, strengthening financial governance and consistency in intercompany arrangements.","[""Cross-Entity Alignment"", ""Financial Governance""]",B2
C7,"Defended the European Transfer Pricing methodology through repeated Management Board challenges and external-auditor stress-testing, iteratively strengthening it until accepted as audit-proof, then delivered knowledge transfer and training to Branch Managers and Accountants across Europe to embed it in practice.","[""Executive Presentation"", ""Stakeholder Persuasion"", ""Training Delivery""]",B2
S1,"Acted as a strategic sparring partner to the Management Board by developing financial models and forward-looking scenarios to support cross-border restructuring and capital structure decisions during the merger of BBSA branches into BBAG.","[""Strategic Advisory"", ""Board-Level Support""]",C0
S2,"Led the complex multi-country transformation and stakeholder coordination across Brazil, Austria, France, Spain, and Italy to successfully consolidate €1.5 billion in assets under the Austrian subsidiary, enabling full Universal Banking License and expanded product capabilities.","[""Multi-Country Transformation"", ""Stakeholder Coordination""]",C1
S3,"Developed business plans and managed regulatory deliverables for multiple European Central Banks (France, Spain, and Italy), securing the necessary approvals for BBAG to establish branches under passporting rights.","[""Regulatory Coordination"", ""Cross-Border Execution""]",C1
S4,"The consolidation of back-office operations into a Shared Services Centre and the merge of the European branches under a single Universal Banking License enabled the bank's European growth platform by broadening the product range and consolidating capital that supported risk-weighted asset growth from €600 million (2009) to over €2 billion (2015).","[""Growth Enablement"", ""Strategic Platform Building""]",C1
P1,"Designed and implemented a Target Operating Model for the European back-office integration, defining clear process ownership and negotiating the split of responsibilities between local branches and the newly established Servicing Center in Portugal.","[""Operating Model Design"", ""Process Ownership""]",D1
P2,"Led the migration of back-office services by engaging with branch leadership across six European countries (Austria, France, Italy, Germany, Spain, and the UK), ensuring alignment and operational continuity during the transition to the centralized Servicing Center.","[""Cross-Border Leadership"", ""Stakeholder Management""]",D1
P3,"Implemented an Activity Based Costing methodology to accurately allocate Servicing Center costs across benefiting branches, enabling transparent cost distribution and supporting OECD Transfer Pricing compliance.","[""Cost Allocation"", ""Performance Transparency""]",D1
O1,"Capable of designing and operating a structured, AI-assisted workflow for complex knowledge work. I can build workflows with reference-data architectures, multi-stage process pipelines, evidence-grounding and quality-control discipline to produce reliable, auditable outputs while actively managing the limitations of generative AI tools.","[""AI-Assisted Workflow"", ""Generative AI Application""]",Overarching Skills
```

Note: `D0` has no bullet yet. `O1`'s `cv_position` (`"Overarching Skills"`) isn't a real `CV_SLOTS` value —
leave it unlinked to any slot, per scope above.

**Known from the parent CI, not re-verified here:** `stars.positionRef` joins are 100% correct (confirmed
via `scripts/diagnose-career-graph-orphans.ts`) — the STAR↔Position relationship itself isn't in question,
only which STAR each CV slot's project name refers to.

### 2.2 Target-state design

1. Query the real `stars` table for this owner: `ref_code`, `title`, `position_ref`, `summary`.
2. For each of the 7 project slots (`A1`, `A2`, `A3`, `B1`, `B2`, `C1`, `D1`), find the STAR whose title
   matches the slot's project name (e.g. `"B1. Accounting Correction Layer Project"` → a STAR titled along
   the lines of "Construction of Accounting Correction Layer"). **Confirm this by reading the real title
   text yourself — don't runtime-fuzzy-match it.** `CV_SLOTS` is already a small, hardcoded,
   profile-specific list (11 entries, written for this one person), so its mapping to real STAR ref codes
   should be hardcoded too, the same way `SENIOR_POSITION_TITLES` is in `lib/career-graph-view-model.ts` —
   an explicit, human-confirmed table, not an inference made at render time. A keyword-overlap algorithm
   was considered and rejected while scoping this: `"Governance Transformation Project"` vs. a STAR titled
   something like `"Transforming Governance Process"` shares only one exact token (`governance`) — different
   word forms (`transformation` vs. `transforming`) don't match as plain string tokens, so a fuzzy matcher
   would likely misfire on exactly this case.
3. For each resolved STAR, read its `position_ref` to get the real owning position. This gives the
   `A`/`B`/`C`/`D` → position mapping with certainty — derived from data, not guessed from the bullet's own
   ref-code prefix letter (`G`/`C`/`S`/`P` correlate suspiciously well with Governance/Controlling/
   Senior-Analyst/Project-Manager, but that's an unverified coincidence noticed in chat, not a stored rule).
   If a letter's own resolved slots disagree on position (shouldn't happen — flag and stop rather than
   pick one).
4. Hardcode both tables in `lib/career-graph-view-model.ts`, near `SENIOR_POSITION_TITLES`, with a comment
   citing that they were confirmed against the live `stars` table on the implementation date:

   ```ts
   // Confirmed against the live `stars` table on <date> — see [[Fix CV Bullet Evidence Linking in the
   // Career Graph]]. Hardcoded rather than fuzzy-matched at render time: CV_SLOTS (lib/cv-slots.ts) is
   // already a small, profile-specific, hardcoded list, so its mapping to real STARs should be too.
   const CV_SLOT_STAR_REF: Record<string, string> = {
     A1: '<real ref code>',
     A2: '<real ref code>',
     A3: '<real ref code>',
     B1: '<real ref code>',
     B2: '<real ref code>',
     C1: '<real ref code>',
     D1: '<real ref code>',
   };
   ```

   The `A`/`B`/`C`/`D` → position mapping can either be hardcoded alongside it or derived at graph-build
   time from `CV_SLOT_STAR_REF` + each resolved STAR's real `positionRef` — implementer's call, but it must
   end up matching reality, not the bullet-prefix-letter guess above.

5. In `buildGraphViewModel`, move the `respByPositionId` map (currently built after the bullets loop,
   around where `starsByPositionId`/`actionsByStarId`/`resultsByStarId` are built) to *before* the bullets
   loop, since the bullets loop now needs it.

6. Rewrite the bullets loop:

   ```ts
   import { CV_SLOTS, slotCode, normalizeCvPosition } from './cv-slots';
   ...
   for (const b of g.bullets) {
     const id = `bullet-${b.id}`;
     nodes.push({ id, type: 'bullet', label: b.text ?? 'CV bullet', data: b });

     const fullSlot = b.cvPosition ? normalizeCvPosition(b.cvPosition) : null;
     const code = fullSlot ? slotCode(fullSlot) : null;
     if (code) {
       const starRef = CV_SLOT_STAR_REF[code];
       if (starRef) {
         const s = starByRefCode.get(normRef(starRef));
         if (s) links.push({ source: `star-${s.id}`, target: id, kind: 'bullet-slot' });
       } else {
         // "*0" role-overview slot — no specific project, link to every Responsibility
         // under that letter's position instead of the position node itself (per the
         // owner: a role-overview bullet is a rollup of the position's Responsibilities).
         const posId = CV_SLOT_LETTER_POSITION[code[0]];
         if (posId) for (const r of respByPositionId.get(posId) ?? []) {
           links.push({ source: `resp-${r.id}`, target: id, kind: 'bullet-slot' });
         }
       }
     }

     // unchanged — bullet→skill via tags
     const seenSkills = new Set<string>();
     for (const tag of b.tags ?? []) { /* ...existing code... */ }
   }
   ```

7. Update the module docstring (top of `lib/career-graph-view-model.ts`) and `GRAPH_FOOTNOTE` — both
   currently say bullets link to a position "only when `cvPosition` text-matches a position title." Replace
   with an accurate description: project-slot bullets link to their STAR via a hardcoded, human-confirmed
   `CV_SLOTS`→STAR mapping; role-overview bullets link to their position's Responsibilities; both are still
   not stored foreign keys (`bullet_bank` has no evidence-source column), so the honesty caveat about "not
   a stored relationship" should stay, just correctly describe *what* the inference is now.
8. Update `[[Career Graph Visualization & Your Story Restructure]]` §2.1/§2.5 to stop describing this as
   "best-effort, sometimes misses" once it's fixed — link to this CI instead.

### Acceptance criteria

- [x] Real `stars` table queried; `CV_SLOT_STAR_REF` built from actually-read title text, not assumed from
      this note's truncated project names
- [x] `A`/`B`/`C`/`D` → position mapping derived from real `positionRef` values, not the bullet-prefix-letter
      coincidence noted in §2.2
- [x] The 24 project-slot bullets (`G1`–`G11`, `C1`–`C7`, `S2`–`S4`, `P1`–`P3`) link to their STAR
- [x] The 3 role-overview bullets (`L2`→A0, `L1`→B0, `S1`→C0) link to every Responsibility under their
      position (or none, honestly, if that position has none recorded)
- [x] `O1` gets no slot-link (expected, not a bug)
- [x] Module docstring and `GRAPH_FOOTNOTE` updated
- [x] `npx tsx scripts/diagnose-career-graph-orphans.ts` re-run — bullet orphan count drops from 27
- [x] `npm run typecheck` clean
- [x] Graph checked visually in the browser: toggle CV Bullets on, click one, confirm the side panel and
      dashed lines point where expected

---

## 3. Resources or references

- `[[Career Graph Visualization & Your Story Restructure]]` — the graph this fixes; originally mis-scoped
  the bullet-linking behavior as "best-effort" rather than "broken."
- `[[Adjustment of Career Graph as Evidence Picker]]` — the future feature this data fidelity work serves.
- `lib/cv-slots.ts` — `CV_SLOTS`, `slotCode`, `normalizeCvPosition`, `evidenceNeedsCvSlot`.
- `lib/career-graph-view-model.ts` — bullets loop, `GRAPH_FOOTNOTE`, `SENIOR_POSITION_TITLES` (the pattern
  to mirror for the new hardcoded tables).
- `scripts/diagnose-career-graph-orphans.ts` — orphan-count verification, before/after.

---

## 4. Notes / Progress log

### 2026-08-06 · Opened

Scoped in a Cowork session with no DB access, while investigating why 27 of 28 CV Bullet nodes rendered as
orphans in the Career Graph. Traced to `cvPosition` being a `CV_SLOTS` slot code, not a position title —
the matching code was checking the wrong thing, not missing data. The user provided the real `bullet_bank`
export directly in chat (reproduced in §2.1) and confirmed two design decisions: role-overview bullets link
to Responsibilities, not the position node; and that a keyword-overlap auto-matcher was the wrong tool given
the "transformation" vs. "transforming" word-form mismatch risk — an exact, human-confirmed mapping was
preferred instead, given this graph is meant to back a future evidence picker. Handed off as a full
Claude-Code-executable instruction rather than continued in the Cowork session, since finishing it needs a
live `stars` table read this session's sandbox cannot reach.

### 2026-08-06 · Delivered

Executed from a Claude Code session in a git worktree (`claude/cv-bullet-evidence-linking-73574e`) branched
off `main` before the parent CI's changes had been committed there — `lib/career-graph-view-model.ts` and
`components/roleproof/career-graph-view.tsx` didn't exist in the worktree at all (git history confirmed they
were never committed on any branch), and the worktree also had no `.env.local`, so no DB access either.
Asked the user how to proceed rather than guess; they committed the parent CI's pending work to `main`
(commit `c5b8910`, plus later commits), then the worktree was rebased onto the updated `main` and
`.env.local` copied over from the primary working directory to restore DB access.

- Queried the live `stars`/`positions`/`responsibilities` tables directly. All 7 STARs mapped cleanly
  one-to-one onto the 7 project slots by reading actual titles (confirming the "transformation" vs.
  "transforming" mismatch risk called out in §2.2 was real — A2's STAR is literally titled "Transforming
  Governance Process"). Every project slot's STAR resolved to the same position for its letter, so
  `CV_SLOT_LETTER_POSITION` is derived at graph-build time from `CV_SLOT_STAR_REF` + each STAR's own
  `positionRef` (throws if a letter's slots ever disagreed, per §2.2's "flag and stop" instruction), not
  hardcoded or assumed from the coincidence that this profile's position refCodes happen to also be
  `A`–`D`.
- Implemented `CV_SLOT_STAR_REF` and the rewritten bullets loop in `lib/career-graph-view-model.ts` per
  §2.2, moved `respByPositionId` ahead of the bullets loop, and updated the module docstring +
  `GRAPH_FOOTNOTE`.
- **Found and fixed a second, related bug while doing the required in-browser check.** The graph's dashed
  lines were correct (confirmed via the live D3 simulation's bound data — 44 `bullet-slot` links, all
  pointing at real STAR/Responsibility nodes), but the side panel (`career-graph-view.tsx`) still showed
  "Overarching — no matching position found from its CV-slot text" for every bullet: it re-derived the
  bullet→position match with its own copy of the old, broken `title === cvPosition` logic instead of
  reading the view-model's actual computed link. Fixed by adding `starByBulletId`/`respByBulletId` to
  `GraphViewModel` (populated once, alongside the real links, in the bullets loop) and pointing the side
  panel at those — the same "one parsing path, not two that could drift" pattern the skill side panel
  already uses via `starsBySkillId`. Not previously specced in §2.5 since it wasn't known to be broken
  until the fix above made it observable.
- **Verification**: `npx tsx scripts/diagnose-career-graph-orphans.ts` — bullet orphans dropped from 26 to
  1 (only `O1`, expected). `npm run typecheck` clean. Full `vitest run` — 201 passed, 3 pre-existing
  failures unrelated to this change (missing local `.storage/jd-captures/*` fixtures, not caused by this
  fix). Checked live in the browser (logged in, `/profile?view=meter`, CV Bullets toggled on): a
  project-slot bullet (B1) now shows "Evidenced by Construction of Accounting Correction Layer and
  Controlling Dashboards"; a role-overview bullet (A0) shows "Rolls up 9 Responsibilities"; `O1` shows "No
  CV-slot link recorded" — all three paths behave as specced.
- Updated `[[Career Graph Visualization & Your Story Restructure]]` §2.1 (un-struck the stale fidelity
  note) and §2.5 (this CI's entry) to point at the real fix instead of describing it as still open.

### 2026-08-07 · Side branch spun out, this CI's own work otherwise unchanged

Designing the `cv_structure` data model (which table/field feeds which CV section) surfaced that
`Group CVs/CV_Template.docx` didn't exist anywhere findable, so C6 had always used the programmatic
fallback, never the real template — a discovery that grew into its own substantial CI rather than staying
a footnote here: `[[CV Header, Skills & Professional Experience - Data-Driven Template Wiring]]` (delivered
same day), plus three parked Ideas it surfaced (`[[C5 Skills Selection Produces Unreadable Overflow]]`,
`[[Generalize CV_SLOTS Beyond a Single Profile]]`, `[[Areas of Expertise and JD Groups - Persistent Data
Model]]`). This CI's own scope and delivered status are unaffected — noted here only for the cross-link.

### 2026-08-07 · Superseded in spirit, not in fact, by `[[Real Bullet Evidence Provenance in the Career Graph]]`

The owner's own hand-drawn data-model diagram, produced while reviewing this CI and CI-039 as closed,
surfaced that `CV_SLOT_STAR_REF` (§2.2 above) answers a slot-level question ("which STAR does this project
belong to"), not the bullet-level one a real Evidence Picker needs ("which exact evidence row was *this*
bullet written from"). This CI's fix and acceptance criteria stand — the graph now links to something real
instead of nothing — but "something real" and "the right thing" turned out to be different bars. The
bullet-level fix is scoped as its own CI rather than reopening this one, since `CV_SLOT_STAR_REF`'s
slot→CV placement relationship stays valid and unchanged regardless of how the evidence-provenance question
gets answered — see that CI for the full analysis, including empirical confirmation that a real bullet can
be built from more than one evidence row.
