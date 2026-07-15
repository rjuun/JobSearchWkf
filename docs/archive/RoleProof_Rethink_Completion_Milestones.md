# RoleProof — Rethink Board: Completion Milestones (2026-07-02)

**Finishing the `RoleProof First-Principles Rethink` board.** The Additive Plan (Waves A/B/C) is now
**almost entirely shipped** — verified against `rafaelperez/RoleProof@main` (commit `e9bb4a8`), not
assumptions. This doc sequences **only what the board still promises but the repo doesn't yet deliver**,
in the same additive spirit: bolt on beside what exists, flag it, attach a reaction signal, pre-decide the
fold question.

**Rule (unchanged):** ship *next to* the current surface · flag it (`NEXT_*` env or per-user) · one
measurable `ux_events` signal · pre-decide the fold question it answers. Instrumentation already exists
(`ux_events`, `activity_events`, `activation_events`, `story_versions`) — every item below emits into it.

---

## Board → repo: what actually shipped (grounding)

Verified present in `main` (component + action + table, not just a stub):

- **2a Coverage Matrix** → `components/roleproof/coverage-matrix.tsx` ✓
- **2b The Statement** → `app/statement/page.tsx` + `lib/activity.ts` (append + rollup) ✓ *(email/re-entry only, below)*
- **2d Proof Link** → `components/roleproof/proof-link-control.tsx` + `app/p/[token]/page.tsx` + `profiles.publicToken` ✓
- **2e Session Ritual** — the stop card → `StopCard` in `components/coach-queue.tsx` (`session_complete`/`keep_going` telemetry) ✓
- **4a Through-line** → `components/roleproof/story-view.tsx` + `lib/story.ts` + `story_versions` ✓
- **4c Excavation** → `engine5Prompts` in `lib/coaching-queue.ts` (behind `env.nextExcavation`) ✓ *(surfacing only, below)*
- **5a Mirror / 5b Doors** → `components/roleproof/discover-view.tsx` + `lib/discover.ts` + `lib/archetypes.ts` ✓
- **6a-lite This-week strip** → `components/roleproof/this-week-strip.tsx` ✓
- **6b The Returns** → `components/roleproof/returns-panel.tsx` + `applications` table ✓
- **6c Sourcing Compass** → `components/roleproof/sourcing-compass.tsx` + `jobLeads.source` ✓
- **Instrumentation** → `ux_events` + `lib/ux-events.ts` ✓

**t1 (1a–1f) is exploration, not backlog.** Those six were the first-win *variants*; the chosen direction
folded into 2a/2c and into the core-product milestones (screen-first onboarding = M4, verdict lexicon,
proof-green). Nothing to build there — they're resolved.

## What the board still promises and the repo doesn't have (this plan)

| # | Board id | Gap | Size |
| --- | --- | --- | --- |
| R1 | **2c + 3c** | Interview Armament + post-CV step — *the only Wave-A item never built* | S–M |
| R2 | **4c fin.** | Excavation, surfaced — engine exists behind a flag; no invitation card, flag off | S |
| R3 | **2b + 2e fin.** | The Statement's re-entry ritual — page exists; no monthly email/return trigger | S |
| R4 | **5c** | Test a Door — a verdict on an unexpected role before flagging it | S–M |
| R5 | **6a full** | The Weekly Triage — the board judges the *whole queue*, not just picks two | M–L |
| R6 | **4b** | The Transition Ledger — the long, slow search reframed as accumulation | M |
| R7 | **3a + 3b** | The assembled Career Graph page + the recruiter's-phone proof view | M |

**Sequence: R1 → R2 → R3 → R4 → R5 → R6 → R7.** Cheapest, highest-emotional-payoff first (R1–R3 close the
loops users feel); the two IA-shifting bets (R5, R7) come once their lighter cousins have earned it.

---

## Wave D — finish the half-built loops (days each)

### R1 · Interview Armament + the step after the CV — (2c) + (3c)
*The one Wave-A promise (A1) with no code yet. Board: `#2c`, `#3c`. It answers the sharpest fold question
on the board — is the **apply** moment or the **interview** moment the emotional peak?*

- **Bolts onto:** the CV-ready panel (already rendered post-generate in `workspace.tsx` / the lead page).
  Download stays exactly as is; a new panel appears beside it — an **Interview Brief teaser** ("what this
  role will probe, and your evidence for each") + "what this taught your graph." A dedicated
  `/roleproof/leads/[id]/brief` (or a tab on the lead) holds the full night-before surface.
- **Data:** none new. The brief re-projects the **C2 evidence mapping** (`requirement_tailoring`:
  `connectionToExpertise`, `evidenceRef`, `cvBullet`) + JD requirements the lead already has. One
  component + one read-only server action; the "left out, on purpose" card (already specced in M7)
  becomes this panel's honest-answer section rather than living on the CV paper.
- **Files:** `components/roleproof/interview-brief.tsx` (new), `app/actions/interview.ts` (read-only
  projection over `jobRequirements` + `requirementTailoring`), a slot in the ready panel.
- **Reaction signal:** `ux_events surface=interview_brief` — `open` per generated CV · `print` · `expand_req`.
- **Fold question:** apply-moment vs. interview-moment as the peak → does the brief out-open the download?

### R2 · Excavation, surfaced — (4c, the last mile)
*`engine5Prompts` is written, dedupes, sits at `VALUE.excavation = 12`, and is gated by
`env.nextExcavation`. The engine works; nothing shows it. Board: `#4c`.*

- **Bolts onto:** `components/coach-queue.tsx`. Excavation prompts must **never queue ahead of real work**
  (their value floor already guarantees this) — so they render as a distinct **invitation card** below
  the ranked queue ("When you have a quiet moment: take me back to *Director, Shared Services*…"), never
  as the auto-advanced hero.
- **Scope:** an `ExcavationInvite` treatment (era eyebrow, breadcrumb question, "not now" that snoozes the
  dedupe key); flip `env.nextExcavation` on for the demo tenant; seed one thin-era position so an
  invitation actually appears.
- **Files:** `components/coach-queue.tsx` (invite card + placement), `lib/env.ts` (default the flag on for
  demo), `scripts/seed.ts` (one under-documented era).
- **Reaction signal:** `ux_events surface=excavation` — `shown` · `accepted` · `snoozed`; minutes-in-session
  and finds-approved (join to `coaching_answers.decision`).
- **Fold question:** do invitations earn their place, or does the never-done meter alone carry rediscovery?

### R3 · The Statement's re-entry ritual — (2b + 2e, the return half)
*`app/statement/page.tsx` renders the stream and `summarizeStatement` rolls it up — but nothing brings the
user **back**. The Additive Plan's B1/A2 fold question ("is the statement the right re-entry ritual vs.
generic reminders?") can't be answered without the trigger.*

- **Bolts onto:** the existing Statement page — add a monthly digest that mirrors it. Start with an
  **in-app "since you were last here" banner** (zero infra) keyed off the newest `activity_events` the user
  hasn't seen; add the email only if the banner earns opens.
- **Scope:** a `lastSeenStatementAt` marker (per-owner), a banner component on app entry, and a digest
  projection reusing `summarizeStatement`. Email is a thin adapter over the same projection (Resend/console
  in dev) — deliberately last, behind `NEXT_STATEMENT_EMAIL`.
- **Files:** `components/statement-return-banner.tsx` (new), `lib/activity.ts` (add `digestSince`),
  `app/actions/statement.ts` (mark-seen), optional `lib/email/statement.ts`.
- **Reaction signal:** `ux_events surface=statement` — `banner_shown` · `banner_open` · `email_open`
  (later) · sessions attributable to the return path.
- **Fold question:** statement-as-ritual vs. generic notifications — does it drive real return sessions?

---

## Wave E — the honest-verdict surfaces (≈1 week each)

### R4 · Test a Door — (5c)
*`discover-view.tsx` shows Mirror + Doors and lets a door become a target lead (`flagDoorAsTargetAction`).
The board's `#5c` adds the missing beat: **walking through** a door — an honest verdict on the unexpected
role *before* you commit — plus your first concrete move.*

- **Bolts onto:** the door card. "Flag as target" stays; a new **"Test this door →"** opens a lightweight
  verdict panel: the B6-scored fit already computed, the two things you'd strengthen (`door.gaps`), and one
  honest line on whether it's a stretch or a real adjacency — then the same flag CTA at the bottom.
- **Data:** none new — reuse the `discover` archetype scoring (`lib/discover.ts`, the existing B6 formula).
  The verdict is a projection, not a new model; keep it deterministic and honest (name the stretch).
- **Files:** `components/roleproof/door-verdict.tsx` (new), a route or drawer in `app/discover`, one read
  action over `lib/discover.ts`.
- **Reaction signal:** `ux_events surface=discover` — `door_test` · `door_verdict_flag` (flagged *after*
  testing) vs. today's direct `flag_target`; the disagree rate on the verdict line.
- **Fold question:** does testing lift door→target conversion, or is the one-click flag enough?

---

## Wave F — the IA-shifting bets (≈2–4 weeks, sequence by reaction)

*These modify a primary surface, so — per the Additive Plan's "explicitly not now" — they ship last, on a
product the lighter versions have already proven alive. Each stays additive: a new tab/default toggle, the
old view one click away.*

### R5 · The Weekly Triage — the full 6a — (6a)
*`this-week-strip.tsx` picks two leads (the 6a-lite). The board's `#6a` is bigger: the board judges the
**whole queue**, not just the top two — capacity-trimmed, with visible rot and auto-hold.*

- **Bolts onto:** the top of `roleproof/page.tsx` / the board, **above** the existing table (which stays,
  unchanged, one scroll down). The strip's two picks become the head of a fuller triage: a **"waiting in
  the queue"** list scored `priority = fit × freshness × competition − flags`, a **capacity line** ("your
  pace: 2 tailorings/week — trimmed to what you can do"), and **auto-hold** of stale leads ("74 d —
  verify it's still open"), so *nothing rots silently*.
- **Data:** all inputs already stored — `postedDays`, `applicantCount`, `overallFitScore`,
  `freshnessBand`/`saturationBand`, `roadblocks`/`misalignments` (flags). Priority is a pure derivation in
  `lib/queries.ts` (extend the `this-week` composition, don't fork it). Capacity = a per-owner setting
  (default 2). Auto-hold = a derived status band, not a destructive write.
- **Files:** `lib/queries.ts` (priority + capacity + hold bands), `components/roleproof/weekly-triage.tsx`
  (new, supersedes the strip behind `NEXT_TRIAGE`), a capacity control.
- **Reaction signal:** `ux_events surface=weekly_triage` — `pick_open`/`pick_tailor` vs. `table_open`
  (do users act on the judged queue or free-roam?); leads dropped for staleness per month.
- **Fold question:** does the full triage deserve to become the **Board default** (demote the raw table)?

### R6 · The Transition Ledger — (4b)
*Not in the Additive Plan and not built — a genuine board-only gap (`#4b`). Month four of a slow search,
reframed as what it is: **accumulation**, not stagnation.*

- **Bolts onto:** the Career Graph / Statement neighbourhood as a **new lens**, composing data that already
  exists — `graph_strength_snapshots` (the meter climbing), `activity_events` (evidence kept, targets
  flagged, CVs made), `story_versions` (the through-line maturing). No new capture: it's a timeline
  projection that says "here's what these months actually built."
- **Files:** `components/roleproof/transition-ledger.tsx` (new), `app/actions/ledger.ts` (projection over
  the three existing streams), a tab beside the Statement.
- **Reaction signal:** `ux_events surface=ledger` — `open` · return-session attribution during a long
  (>30-day) search with no application outcome yet.
- **Fold question:** does the ledger sustain the long-tail user (weeks 6–16) better than the meter alone?

### R7 · The assembled Career Graph page + the recruiter's phone — (3a + 3b)
*The parts exist; the board's `#3a` **composes** them and `#3b` optimises the shared artifact for the
device it's actually read on.*

- **3a — Assembled page:** make the **Coverage Matrix (2a)** the primary face of the Career Graph, with the
  **Statement (2b)** as its living-history rail — the "graph page assembled" the board draws. Additive: a
  new default layout for `app/profile` (graph) that arranges existing components; the current strength-meter
  view stays reachable as a lens (ties into core-product M1/M6).
- **3b — Recruiter's phone:** `app/p/[token]/page.tsx` exists but is desktop-first. Ship a deliberate
  **mobile proof view** — where a recruiter actually reads it — tuned for a 430px screen (`ios-frame.jsx`
  is already in the project for prototyping it): proof lines, provenance, zero contact fields.
- **Files:** `app/profile/page.tsx` (assembled layout behind `NEXT_GRAPH_ASSEMBLED`),
  `app/p/[token]/page.tsx` (responsive pass), no schema change.
- **Reaction signal:** `ux_events surface=graph_page` — matrix dwell vs. meter dwell · `ux_events
  surface=proof_link` `mobile_open` share and third-party visits.
- **Fold question:** matrix-assembled vs. meter as the graph's default face (the M1/M6 fold, now with data).

---

## Cross-cutting (unchanged from the Additive Plan)

- **Nothing removed, nothing replaced** until a fold question is answered by real `ux_events` — every item
  ships beside what exists, behind a flag.
- **Deterministic where it counts:** priority, fit, verdict and strength never call the LLM (extend
  `lib/queries.ts`, `lib/discover.ts`, `lib/scoring.ts`); the model narrates and drafts only.
- **One signal per surface, no filler:** each new panel earns its place with 2–3 events and one honest line —
  no dashboards of vanity numbers.

## Fold decisions this plan will finally let us make

- Interview brief (R1) → is the peak the apply or the interview moment?
- Excavation invitations (R2) → keep, or let the never-done meter carry rediscovery?
- Statement ritual (R3) → replace generic notifications as the re-entry?
- Test-a-door (R4) → does the verdict lift door→target conversion?
- Full triage (R5) → promote to the Board default, demote the raw table?
- Transition Ledger (R6) → the retention surface for the long, slow search?
- Assembled graph (R7) → matrix-first vs. meter-first as the graph's face.

## Explicitly still not here (core-product milestones, tracked separately)

Queue re-ranking (M2), screen-first onboarding as the default front door (M4 — note `app/start`,
`app/signup` now exist as the on-ramp), dashboard demotion, and the machinery-toggle IA changes live in
`RoleProof_Milestones.md` (M0–M7). They *modify* shipped behaviour, so they stay sequenced there, after
reactions to these additive finishers.

## Effort summary

- **Wave D (R1–R3)** ≈ 5–8 days → the half-built loops finally *close* and start emitting fold evidence.
- **Wave E (R4)** ≈ 3–5 days → the honest-verdict beat that makes Discover more than a list.
- **Wave F (R5–R7)** ≈ 2–4 weeks, reaction-gated → the two IA bets, taken only once their light versions earn it.

Total ≈ 3–5 working weeks solo. After Wave D the Rethink board is *functionally complete*; Waves E–F are the
differentiation bets that a proven-alive product can afford.
