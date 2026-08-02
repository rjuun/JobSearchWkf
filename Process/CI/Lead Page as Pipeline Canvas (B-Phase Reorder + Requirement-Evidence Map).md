---
ci-area: Screening / B-Phase + Lead Page UX
ci-roadmap:
ci-title: Lead Page as Pipeline Canvas — B-phase reorder + requirement-evidence Map
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-07-30
ci-estimated-time: 12
ci-time-spent: 10
pr-source: "[[B5. Extract Requirements from Job Description]]"
pr-target: "[[B2. Extract Requirements from Job Description]]"
---

---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-07-29T12:45:19.000Z","endTime":"2026-07-29T16:28:21.000Z"},{"name":"Draft","startTime":"2026-07-29T20:30:27.000Z","endTime":"2026-07-30T00:30:29.000Z"},{"name":"Development","startTime":"2026-07-30T00:46:43.000Z","endTime":"2026-07-30T03:12:50.000Z"}]}
```
---

## 1. What is the problem or opportunity?

Two problems that turn out to be the same problem.

**The tailoring UI forces one-to-one matching.** Testing C1–C6 end to end (2026-07-29) surfaced that the
app walks the user through job requirements sequentially, one requirement at a time, matching each to a
single CV bullet. Reggie's words: *"it limits the fulfilment of the job requirement by matching a single cv
bullet which is far from ideal"* and *"it does not allow me to have a big picture of what stars, attributes,
competences responsibilities from my profile could be additionally reinforcing the fulfilment of this
specific job requirement."* Requirements are genuinely many-to-many with evidence — requirement 1 below is
supported by three separate items across two positions — and a sequential wizard structurally cannot show
that.

**The Lead page shows process, not product.** The current page spends its most valuable real estate on
*How RoleProof checked* — six plain-English restatements of what the B steps did. That box is narration.
Every fact inside it already exists as a first-class field somewhere (roadblocks, misalignments, freshness,
skills count, fit score), and once those fields are surfaced properly the narration is redundant. Meanwhile
`Must-haves` and `Skills` sit as tabs behind the JD, which is exactly backwards: the requirements are the
thing the whole B phase produces, and they're hidden one click deep.

The opportunity is to replace both with a single artifact — a **Map** with the CV's structure on the left,
profile evidence in the middle, and job requirements on the right, connected by lines — that is *the same
component* from B1 through C7. It starts empty at capture and fills in as each step runs, so the page
becomes a canvas that shows the pipeline's work accumulating rather than a set of panels describing it.

Prototype built and validated across four iterations with Reggie (2026-07-29/30); final state is
`lead-page-design.html` (outputs folder, attached to this CI).

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:**
- Reordering the B phase so requirement extraction runs first (§2.1) — a rename of five `Process/*.md`
  notes plus the step registry, not a rewrite of their content.
- Four documentation corrections found while verifying Reggie's assumptions (§2.2). Three of these are
  fixes to things that are *already* right in the notes but wrong in our shared mental model; one is a
  genuine defect (the label collision).
- Lead page layout: JD panel height-pinned, freshness/saturation chips, `How RoleProof checked` deleted,
  Key Patterns box extended with roadblocks + misalignments (§2.3).
- The Map component itself, with per-phase population states (§2.4).
- Roadblock display as a `Block` value in the Map's Assessment column (§2.5).

**Out of scope (deliberately):**
- The evidence picker's own design. Reggie: *"I believe the Evidence Picker in the bottom can be improved,
  but lets do this once this interaction is connected with the Database and we are able to see it working."*
  Ships as-is (tabbed, flat lists); redesign is its own CI once real data is flowing through it.
- C2–C7 changes. The Map is built to serve them (that's the point) but this CI stops at B6. C-phase
  wiring is Part 2.
- Any change to the B6 scoring formula or its weights.

### 2.1 B-phase reorder

Current order and the order this CI moves to:

| Today | New | Note title (unchanged content) |
| --- | --- | --- |
| B1 | **B1** | Capture Posting Freshness and Market Saturation |
| B5 | **B2** | Extract Requirements from Job Description |
| B2 | **B3** | Identify Roadblocks |
| B3 | **B4** | Identify Misalignments |
| B4 | **B5** | Translate Requirements to Areas of Expertise and Define JD Groups |
| B6 | **B6** | Role Fit & Investment Worthiness Score |

**Why this is right, and it isn't the reason we first assumed.** The initial argument was "the Map's right
side needs requirements early." True, but that's a UI convenience and a weak basis for renumbering a
process. The real argument is in the note titles: **B4 is called _Translate Requirements to Areas of
Expertise_ and currently runs before requirements exist.** Today it necessarily translates the raw JD, not
the requirements, because there is nothing else available to it. The title and the execution order have
been contradicting each other since the note was written. Extraction-first resolves that, and the UI
benefit follows for free.

Second, real dependency: §2.5 attaches roadblocks to specific requirement rows. Roadblocks cannot reference
requirement IDs that don't exist yet, so extraction must precede B3 (new numbering) for that to work at all.

**Cost consequence — needs a decision, see §4.** `lib/pipeline/screening.ts` currently splits B into two
halves: `runInitialChecks` (B1→B2→B3 today) fires automatically from `createLead()` at capture, and
`runScoring` (B4→B5→B6) runs later on demand from the Ready-to-score batch runner. Putting extraction first
would drag an LLM call into the automatic-at-capture half, which directly contradicts A1's stated
principle: *"without burning B/C-phase LLM calls on leads that may never be promoted."*

~~Recommended resolution: move the whole B2–B6 block to on-demand. Only B1 stays automatic.~~ **Superseded
2026-07-30 — see §4 item 1 and §4.2.** Final resolution: **B1→B4 (new numbering) run automatically at
capture; B5–B6 stay a manual batch decision from the queue.** This is closer to what's already live today
(see §4.2 for why) than the on-demand-everything version above.

### 2.2 Documentation corrections

Four findings from reading the notes rather than assuming. Three correct our shared model; one is a real
defect.

**(a) ATS is not in B5 — it never was.** `B5. Extract Requirements` contains no ATS section at all. ATS
identification lives in **B4 §C** (`Translate Requirements to Areas of Expertise`), and `A1 §B.2` already
does deterministic domain-pattern detection at capture. A1 is explicit that the two are complementary:
*"B4 still runs its own (LLM-based, JD-content) detection as the fallback for anything not caught here, so
this is additive, not a replacement."*

So there is nothing to delete from B5. **But B4 §C should be deleted outright, and A1 should own ATS
end to end.** This reverses an earlier recommendation in this same CI ("keep both, make B4 conditional"),
which was based on an assumption about B4's inputs that turned out to be false when checked.

**What B4 actually receives — verified, not assumed.** `lib/pipeline/screening.ts:189`:

```ts
user: `JOB DESCRIPTION:\n${jd || lead.title}`,
```

The JD text, and nothing else. No `sourceUrl`, no `jobPostLink`, no `candidateLinks`, no browsing tool.
B4 §C's central instruction — *"You must identify the real ATS by checking the application flow. Use the
Job Post Link column… This is the company's official careers page"* — therefore cannot execute. It directs
the model to open a link it is never passed and has no means of fetching. Anything B4 returns in
`atsSystem` is inferred from job-description prose, and ATS identity does not live in JD prose; it lives in
the page chrome (apply form, iframe host, footer branding). This is very likely why the header chip reads
`ATS · Unknown` in practice.

**Live bug this exposes.** `screening.ts:203`:

```ts
atsSystem: r.data.atsSystem ?? lead.atsSystem,
```

B4's value takes precedence whenever it is non-null. So a value guessed from prose **overwrites the
deterministic hostname match A1 already stored**. A verified value is replaced by an unverifiable one — a
direct breach of the system's own non-negotiable against unevidenced inference (`lib/prompts.ts`
`NON_NEGOTIABLES`). This is a defect independent of everything else in this CI and worth fixing on its own
merits.

**Why A1 is the right and sufficient home.** A1 is the only step in the entire pipeline that ever holds the
*rendered page*. Two mechanisms live there, and between them they dominate anything B4 could do:

| Mechanism | Where | Cost | Catches |
| --- | --- | --- | --- |
| Hostname match `detectAtsSystem()` | A1 §B.2 — **already implemented and unit-tested** (`lib/pipeline/capture-enrich.ts:68`, incl. a `onlyfy.jobs.evil.com` spoof test) | free, code | apply URL is an ATS vendor domain |
| Inline agent extraction | A1 §C — **add ATS to the existing extraction** | **free** — no extra model call | company-hosted postings, LinkedIn Easy Apply, anything where the ATS shows in page chrome |

The second one is the answer to "can't it be done in the first pass?" — yes, and at zero marginal cost.
A1 §C already states: *"Since the agent already has the full JD text in context from step 2, it extracts
`company`, `city`, `remote`, and `formatSignals` itself as part of the same read — no separate model call
needed for this path."* ATS is the same kind of extraction from the same read. It is strictly more informed
than B4, because the agent saw the apply flow and B4 only ever sees prose.

**Decision:**
- Add `atsSystem` to A1 §C's inline extraction list (and to `CaptureInput` / the DeepSeek fallback schema),
  with the rule: report it only if visibly evidenced on the page — form host, iframe, footer branding,
  apply-button destination. Never infer from prose. Leave null otherwise.
- Precedence at capture: deterministic hostname match (§B.2) wins; agent extraction fills only where it
  returned null.
- **Delete B4 §C entirely.** Remove `atsSystem` from B4's tool schema (`lib/llm/schemas.ts:113,130`) and
  drop the write at `screening.ts:203`. B4 keeps skills, JD groups and key patterns — all of which it *can*
  do from JD text.
- The known-ATS list then exists once, in A1 §B.2, ending the divergence between the two notes (B4 lists
  Jobvite / UKG / Umantis; A1 lists Personio / Avature / Cornerstone / Oracle Fusion / Onlyfy — neither
  complete, and which one applied depended on which step ran).

**On "should the second pass be B1?"** — the instinct is right (B1 is where cheap objective facts about the
posting belong) but it inherits the same defect: B1 parses JD header text and has no browser either. The
only second look that can add information is one that *re-reads the page*, and A1 already anticipates
exactly that under Notes: *"let the user re-run capture against the same lead's `sourceUrl` to refresh just
those two fields… without re-running B2–B6."* ATS should ride along on that refresh. So the second pass is
A1 again, not a new step — no LLM step anywhere needs to own this.

**(b) Core / Important / Nice-to-Have is already in B5, from the JD's perspective.** `B5 §B Priority
Groups` classifies every requirement Core / Important / Nice-to-Have using JD language as the test
("required", "must have" → Core; "preferred", "ideally" → Important; "a plus", "desirable" → Nice-to-Have).
That is precisely the behaviour requested. No move is needed.

**(c) The real defect: a label collision between B4 and B5.** What B4 has is a *different* rating — the 17
Areas of Expertise scored 1/2/3 — whose **labels happen to read `Core` / `Important` / `Supporting`**. Two
unrelated scales, overlapping vocabulary, adjacent steps. That collision is what made it look like
categorization lived in B4.

**Fix:** rename B4's rating scale so the words stop colliding. Proposed: `1 = Central` / `2 = Contributing`
/ `3 = Peripheral`. Values and meanings unchanged; only the labels move. `Core` / `Important` /
`Nice-to-Have` then belongs unambiguously to requirements, and the `requirement_rank` enum in
`DATA_MODEL.md` stays exactly as it is. This is an Accuracy Improvement Tip in its own right — the confusion
was real, and it was caused by naming, not by process.

**(d) Misalignments do not gate the lead.** The working assumption was *"if there are Roadblocks or
Misalignments, the Job Lead will stop processing at this point."* That is correct for roadblocks and wrong
for misalignments. `B3. Identify Misalignments` says so twice, in bold: *"A misalignment flag does **not**
stop the process — it is a conscious awareness marker"*, and again under Seniority: *"A Seniority
Misalignment does **not** stop the process."* `PIPELINE.md` agrees, describing B3's output as *"flags (not
blockers)"*.

The current implementation is already right — anything flagged parks at `scoring_queue` for a human
decision rather than dying. **Implementing a hard misalignment gate would be a regression**, and would
silently kill leads that today reach Reggie's desk. The design reflects the correct behaviour: roadblocks
render in oxblood and gate promotion; misalignments render in red inside Key Patterns and gate nothing.

### 2.3 Lead page layout

- **JD panel height-pinned.** `The role` panel gets a fixed height equal to the right column's natural
  height (score card + pipeline + promote + Key Patterns), with internal scroll for the remainder. This is
  what keeps the Map's top edge at a constant Y regardless of JD length — Reggie's explicit requirement.
- **Tabs removed.** `Must-haves` and `Skills` tabs are deleted from `JdReader` (`workspace.tsx` ~line 658).
  Requirements now live in the Map; skills ratings surface via the JD-group chip and the Areas of Expertise
  panel. `The role` becomes a plain header, not a tab.
- **Freshness + saturation chips** occupy the freed space, right-aligned in the JD panel's header bar,
  colour-coded per `B1 §C`: green 0–7 days / yellow 8–21 / orange 22–60 / red 61–120 / dark 120+; and
  green <30 applicants / yellow 30–99 / red 100+. Both render as `pending` (grey) before B1 runs.
- **`How RoleProof checked` deleted.** `ChecksCard` and `CHECK_QS`/`buildChecks` (`workspace.tsx` ~lines
  917–995) come out. The running-state variant of the same component stays — a live "step N of 6" progress
  card is still useful *while* screening runs; it's only the post-hoc summary that's redundant.
- **Key Patterns box** takes that slot: `job_leads.key_patterns` prose at top, then a roadblocks section
  (oxblood, "these gate the lead") and a misalignments section (red, "awareness only, not a gate"). Empty
  state before B3/B4 run.

### 2.4 The Map

One component, six population states, mounted below the fold on the Lead page.

| After | Left (CV structure) | Middle (evidence) | Right (requirements) | Assessment column |
| --- | --- | --- | --- | --- |
| A1 | full skeleton, all 6 positions | empty lanes | empty | — |
| B1 | unchanged | empty | empty | — |
| **B2** | unchanged | empty | **populated** — order, tier, requirement, original JD text | `pending` |
| B3–B4 | unchanged | empty | unchanged | `Block` on blocked rows only |
| B5 | unchanged | empty | unchanged | unchanged |
| **B6** | unchanged | **populated** from Master Bullet Bank | unchanged | full: Very strong / Strong / Partial / Gap |

Left column reads `positions` → `stars`/`responsibilities` to build `cv_position → cv_heading` lanes. Every
position gets a `Role Overview` lane plus one lane per STAR. All six positions appear including Unilever
and Tokyo, even where they hold no evidence for this JD — the skeleton is the CV's real shape, not a
filtered view.

Right column renders `job_requirements` with the assessment strip visually separated (its own subheader and
a heavier divider), requirement + original JD text in the body, `requirement_order` and a `requirement_rank`
colour band on the far right.

**Tier band.** `requirement_rank` renders as a full-height vertical bar at the row's right edge, on a
saturation ramp: Core `#0C447C` (solid dark), Important `#85B7EB` (mid), Nice-to-have `#DFEAF6` with a
hairline border (pale). Darker = more important, so the column scans as a weight profile without reading a
word. The three labels appear **once**, as a legend in the requirements subheader — never repeated per row.
Colour alone must not be the only carrier: the band gets a `title`/`aria-label` with the rank name for
accessibility and hover.

Middle column is `requirement_tailoring` rows: `original_text` placed in the lane matching its
`cv_position`, drag-and-drop between the picker and the lanes, with the drop rejected unless position and
heading match the evidence's true source. Colour states map to the existing `approval_status` enum —
`green` (placed/keep), `yellow` (candidate, has fulfilment power), `pending`/uncoloured (low relevance).
Reusing that enum rather than inventing a parallel vocabulary is deliberate.

Clicking a requirement traces SVG curves to every supporting evidence item and vice versa — the many-to-many
view the sequential wizard couldn't give.

### 2.5 Roadblocks in the Assessment column

When B3 records a roadblock that maps to a specific extracted requirement, that requirement's Assessment
cell reads **`Block`** (oxblood chip) instead of a fulfilment value, and the description explains why.

**Edge case that needs handling.** B3's roadblock categories — language, technical, certification,
geographic, industry — are evaluated against the JD as a whole, not derived from extracted requirement rows.
Some map cleanly onto a requirement (a German-language demand maps onto the bilingual-communication
requirement). Others won't map to any single row: an industry roadblock is usually implied across a whole
posting rather than stated as one line.

Resolution: roadblocks carry an optional `requirement_id`. Mapped ones render as `Block` in that row's
Assessment cell; unmapped ones render only in the Key Patterns roadblocks section. Both always appear in
Key Patterns, so nothing is visible in one place only.

---

## 3. Schema changes

Small — most of this is presentation over data that already exists.

- `job_leads.roadblocks` is already `jsonb` typed as `Roadblock[]`. Add an optional `requirementId?: string`
  to the `Roadblock` type (`lib/db/schema.ts`). No migration — jsonb.
- `job_requirements` needs the original JD sentence the requirement was drawn from. `description` currently
  holds a "faithful close paraphrase" per B5 §C.4, which is not the same thing as the verbatim source. Add
  **`source_text text`** — a real `ALTER TABLE ADD COLUMN`, nullable, backfilled null for existing rows.
- Pipeline step registry: whatever maps step codes to `Process/*.md` notes and to `pipeline_runs.step` must
  be renumbered in lockstep with the file renames. **Existing `pipeline_runs` rows carry old codes** — either
  migrate them or key the registry on note identity rather than the `B<n>` string. Migrating is cleaner;
  a lead screened before this change would otherwise show a B2 trace meaning "roadblocks" next to a B2 trace
  meaning "requirements".

### 3.0 ATS ownership move (§2.2a) — code changes

| File | Change |
| --- | --- |
| `Process/A1. Capture and Store Job Leads.md` §C | add `atsSystem` to the inline extraction list + the "visibly evidenced only, never inferred from prose" rule |
| `Process/A1…md` §B.2 | absorb B4 §C's table entries (Jobvite, UKG Pro, Umantis) — becomes the single canonical list |
| `Process/B4…md` §C | **delete**; note keeps skills / JD groups / key patterns |
| `lib/llm/schemas.ts:113,130` | remove `atsSystem` from B4's tool + zod schema |
| `lib/pipeline/screening.ts:203` | drop the `atsSystem:` write — this is the overwrite bug |
| `lib/pipeline/screening.ts:213` | remove `atsSystem` from the B4 report summary string |
| `lib/pipeline/capture.ts` (`CaptureInput`) | accept `atsSystem?: string` from the agent path |
| `lib/pipeline/capture-enrich.ts` | precedence: hostname match wins, agent value fills nulls only |
| `docs/PIPELINE.md` B4 row | drop "+ ATS" from the step label and output description |

`detectAtsSystem()` itself needs no change — it is already implemented and unit-tested.

### 3.1 Files the renumber touches — verified against the repo, not inferred

| File | What changes |
| --- | --- |
| `Process/B2..B5*.md` | four `git mv` renames + `pr-title` frontmatter in each |
| `lib/prompts.ts` §`STEP_NOTE` | keys **and** filenames both move; they must stay paired (verified: the map is literal, lines 9–20) |
| `lib/llm/schemas.ts` | exported schema objects are named `B2`…`B6`; rename in lockstep |
| `lib/pipeline/screening.ts` | step string literals in `recordRun`/`reports`/`systemPromptFor`, and the `runInitialChecks` / `runScoring` split itself (§2.1 cost decision) |
| `components/roleproof/workspace.tsx` line 467 | `SCREEN_CODES` array order |
| same, lines 990 / 1062 / 1264 | three `TraceDisclosure` step arrays — hardcoded, all three need the same order |
| `docs/PIPELINE.md` | mermaid flow + the B-step table |
| `pipeline_runs` rows | data migration for historical `step` values |

The renames are mechanical; the risk is missing one of the three duplicated `TraceDisclosure` arrays, which
would fail silently (a trace panel that renders nothing rather than erroring).

---

## 4. Decisions taken (2026-07-30)

All five items below were raised as open questions and **accepted by Reggie on 2026-07-30**. Recorded here
as settled, not as pending.

1. **Cost / trigger point (§2.1) — accepted 2026-07-30, reopened and revised 2026-07-30, see §4.1a.**
   Final: B1→B4 (new numbering: Freshness → Extract Requirements → Roadblocks → Misalignments) run
   automatically at capture. B5 (Areas of Expertise) and B6 (Role Fit Score) stay a manual batch decision
   from the queue. A freshly captured lead arrives with requirements, roadblocks, and misalignments already
   populated — closer to today's live behaviour than either of the two versions that preceded it.

2. **B4 label rename (§2.2c) — accepted.** Areas of Expertise scale becomes
   `1 = Central / 2 = Contributing / 3 = Peripheral`. `Core / Important / Nice-to-Have` belongs to
   requirements only. `requirement_rank` enum unchanged.

3. **`source_text` backfill (§3) — accepted as "leave historical".** Already-screened leads keep a null
   `source_text` and show no JD quote in the Map. No re-run of B2 across the back catalogue.

4. **Misalignments do not gate (§2.2d) — confirmed.** No code change; the current behaviour is already
   correct. Recorded so a future pass doesn't "fix" it into a gate.

5. **Evidence picker — deferred to its own CI**, once real data is flowing through the Map.

### 4.1 Follow-up raised on review — ATS ownership

Reggie pushed on this three times, and was right each time. The sequence is worth recording because the
first two answers were wrong.

1. *"If ATS is captured in A1 §B.2, why do we need it in B4 §C?"*
2. First answer: keep both, they catch different leads. **Wrong** — asserted that B4 reads "the posting and
   its application flow" without checking what B4 is actually passed.
3. *"Can't it be done in the first A1 pass? If a second pass is really needed, should it not be B1?"*
4. Checked `screening.ts:189`: B4 receives `JOB DESCRIPTION:\n${jd}` and nothing else. B4 §C is
   unexecutable as written, its output is prose inference, and `screening.ts:203` lets that inference
   **overwrite** A1's verified hostname match.

**Settled:** A1 owns ATS end to end — deterministic hostname match plus inline agent extraction from the
rendered page, both at zero marginal cost. B4 §C is deleted. Any re-check rides on A1's existing
"refresh without re-screening" hook rather than becoming a B1 or B4 responsibility. Full reasoning in
§2.2(a).

**Process note.** The first answer was an assumption stated with the confidence of a verified fact. The
correction only surfaced because Reggie kept asking. Cheap check available and not taken: read the `user:`
line of the step before describing what the step can see.

### 4.2 Follow-up raised on review — the gate, reopened

Reggie, after accepting item 1 above: *"How problematic would it be if we allow new queued Job Leads to
process from A1 to B4. From the queue I'd decide in a batch which to proceed and which to abandon
(roadblocks/misalignments). Redo the estimate on 160 leads/month captured, 40 processed to completion."*

**What "batch decide, don't auto-abandon" already is.** `screening.ts:51` — `gateStatusFor(roadblockCount,
misalignmentCount)` — returns `selected` if both counts are zero, `scoring_queue` otherwise. Nothing is ever
auto-abandoned; a flagged lead parks at `scoring_queue` and waits for a human call. Today's live
`runInitialChecks` (B1→old-B2→old-B3, i.e. new B1/B3/B4) already fires this automatically at
`createLead()`, gated only by B1's freshness short-circuit (`PIPELINE.md`: "a posting ≥60 days old reaches
`hold` with no B2/B3 rows at all"). **Reggie's proposal is not a new gate design — it's today's live gate,
plus Extract Requirements (new B2) added to the automatic half.** The on-demand-everything version accepted
earlier this same day (§2.1, struck through above) would have been the bigger behaviour change, removing
automation that already exists in production.

**Cost, from real numbers already in the vault** (`Process/CI/Migrate LLM Provider - DeepSeek to Claude
(Sonnet 5 + Opus 4.8, Single Provider).md` §2.5, §3), not a fresh guess:

- Modeled full pipeline (Capture→C7, one lead), Claude-only: **≈$0.27/lead**. Opus-tier steps (B6, C2, C3,
  C5, C7) are ~82% of that. The remaining ~18% — **≈$0.049/lead** — is the four Sonnet-5 B-phase calls
  (old B2/B3/B4/B5 = new B3/B4/B5/B2), so **≈$0.012/call** average.
- Sonnet 5 is $2/$10 per MTok through 2026-08-31 (then $3/$15) — still today's price, one month of runway
  left on it.
- Auto-running three of those four calls per capture (new B2 Extract, B3 Roadblocks, B4 Misalignments;
  new B5 Areas-of-Expertise stays manual) ≈ 3 × $0.012 ≈ **$0.0365/lead**, unconditionally, for all 160
  captures/month ≈ **$5.84/month**.
- Today's live behaviour already spends 2 of those 4 calls (Roadblocks + Misalignments) on all 160/month
  ≈ **$3.89/month**. The incremental cost of this proposal over what's *already running in production* is
  one more call (Extract Requirements) × 160 ≈ **+$1.95/month**.
- Versus the on-demand-everything design accepted earlier today (§0 auto-spend, cost only on leads Reggie
  explicitly screens): the delta is the full $5.84/month, spent on 160 leads/month to save the trigger-click
  on the 40 that reach tailoring.

**Caveat, stated honestly rather than smoothed over:** the $0.012/call average assumes the caching cadence
this pricing was modeled against — 8–12 leads per sitting, consecutive same-step calls landing inside the
1h cache window. Firing at capture time means new-B2 calls are scattered through the day rather than
batched, the same "unpredictable hit rate" the migration CI already flagged for old-B2/B3 and shrugged off
as "that's fine, don't special-case it." Worst case (zero cache hits, every call pays the 2× write
surcharge instead of the 0.1× read rate) roughly doubles the write-token portion of that one call — moves
$5.84/month to something still under $10/month. At this volume, caching is a rounding error, not a decision
input.

**Answer to "how problematic": not very.** It's a smaller behaviour change than what's already recorded as
accepted, it reuses a gate mechanism (`gateStatusFor`) that's already live and already non-abandoning, and
the incremental spend over current production behaviour is about two dollars a month. The real product
upside is that the Map's requirement side populates at capture with no manual trigger, which is what §2.4
wanted in the first place. Item 1 above and §2.1's resolution line now reflect this as the final decision;
WP3 in the handover prompt needs the same correction since it was written to the earlier on-demand version.
