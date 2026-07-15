# Roadmap — Build Record & What's Next

> **Status: P0–P5 delivered and live** on Vercel (`role-proof.vercel.app`), plus several
> post-P5 waves (onboarding O2–O4, the journey-first redesign M0–M7, Additive A/B/C, Rethink
> Completion D/E/F). This doc is now the **historical build sequence** (below) plus the remaining
> forward work ([Scheduled cleanup](#scheduled-cleanup-p6-post-prototype) and
> [Delivered since P5](#delivered-since-p5)). Per-wave detail lives in
> [`docs/archive/`](archive/README.md).

The original plan was sized for **one person building with Claude Code**; each phase ended at a
**screen-shareable state** with a concrete acceptance criterion.

## Phase 0 — Document & Blueprint ✅ done

- **Goal:** capture the system as documentation; set up git; produce the dev + deployment plan.
- **Deliverables:** `README.md`, `CLAUDE.md`, `docs/` (ARCHITECTURE, DATA_MODEL, PIPELINE, ROADMAP,
  DEPLOYMENT, bpmn), local git repo with personal data gitignored.
- **Done when:** the blueprint is committed and a newcomer can understand the system and the build
  plan from the repo alone. *(No application code.)*

## Phase P1 — Scaffold + Schema + Auth + Seed ✅ done

- **Goal:** a deployed, authenticated app holding the real data.
- **Deliverables (as built):**
  - Next.js (App Router, TS) app; Supabase project.
  - Drizzle schema + journaled migrations (`drizzle/`); owner-scoped in the app layer (no RLS).
  - **Self-contained auth** — a `jose`-signed session cookie + `scrypt` over a `users` table
    (`lib/auth.ts`). *(The original plan called for Supabase Auth magic-links; it shipped
    self-contained instead — simpler, no Auth provider to configure.)*
  - `npm run seed` — imports both workbooks + the markdown JDs into Postgres/Storage
    (see [`DEPLOYMENT.md`](DEPLOYMENT.md#seeding)).
- **Acceptance / demo:** log in to the deployed app; `/roleproof` lists the ~140 real leads and a lead
  detail shows its requirements and B6 scores **read from Postgres** (migrated, not typed in).

## Phase P2 — Capture + B-Screening + B6 Scoring (the analytical core) ✅ done

- **Goal:** run the full B pipeline on a lead, live.
- **Deliverables:**
  - `/api/ingest` Route Handler + the LinkedIn bookmarklet.
  - `lib/llm/client.ts` (`runStructured`: model-per-step, tool-use, Zod validation, token logging).
  - B1–B6 step modules + the **deterministic `lib/scoring`** rollups + the B1/B6 gates.
  - Pipeline console UI: per-step progress (driven by `pipeline_runs`), streaming output, and a
    B6 result card with the 5-dimension breakdown + recommendation gate.
- **Acceptance / demo:** import a fresh JD → click **Screen** → watch B1→B6 run → get a Role Fit
  Score and tier that **matches the hand-calculated number**, with the per-requirement table filled.

## Phase P3 — C-Tailoring + CV Generation (the differentiator) ✅ done

- **Goal:** produce a tailored, 2-page `.docx` for a promoted lead.
- **Deliverables:**
  - C1–C7 step modules.
  - The **C2 Keep/Maybe/Drop gate UI** (the human-in-the-loop centrepiece).
  - `lib/docx` CV compiler: re-tag the template once, then `docxtemplater` fill from Keep bullets;
    PDF preview (best-effort) + `.docx` download.
  - **Day-one task:** a render test proving the re-tagged template fills correctly (de-risks the
    placeholder-fragmentation issue before building the rest of C).
- **Acceptance / demo:** promote a *Proceed* lead → map evidence → mark a few bullets Keep/Drop
  → generate → preview a clean **2-page** CV → download the `.docx`.

## Phase P4 — CI Surfaces + Polish ✅ done

- **Goal:** replace the Obsidian dashboard with RoleProof-native board/profile/workspace surfaces.
- **Deliverables:** board metrics, workspace run traces, CI initiatives/tips in the profile loop,
  and a cost/usage panel from `llm_calls`; empty states, loading skeletons, error handling.
- **Acceptance / demo:** open `/roleproof` and a lead workspace mid-screen-share; together they tell
  the pipeline's story at a glance.

## Phase P5 — Deploy Hardening + Share ✅ done

- **Goal:** a stable, shareable URL.
- **Deliverables:** Vercel production env + a dedicated prod Supabase project (seeded); secrets set;
  custom domain; whole-app auth gating; a short "how to demo" script (README or Loom).
- **Acceptance / demo:** send the URL to a third party → they hit a login wall → you log in and run
  a lead end-to-end with no local server.

## Delivered since P5

Beyond the P1–P5 plan, the prototype grew through several review-gated waves. Detail + review
pages are in [`docs/archive/`](archive/README.md):

- **Onboarding O2–O4** — career-graph extraction, coaching loop, multi-tenant signup (`/signup`,
  empty graph per new user).
- **Design/personality pass** — the "Quiet Confidence" design system (see
  [`design/DESIGN_SYSTEM.md`](design/DESIGN_SYSTEM.md)).
- **Milestones M0–M7** — the journey-first redesign (two-pane workspace, coach upgrade, demo runbook).
- **Additive waves A/B/C** — interview brief, Discover, Excavation, Proof Link, coverage/compass.
- **Rethink Completion D/E/F** — finished the half-built loops from the redesign board.

Live-ops (deploy, seed, demo-login sync) are documented in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Scheduled cleanup (P6, post-prototype)

- **Rename the `approval_status` enum** `green/yellow/red` → `keep/maybe/drop` to match the UI vocabulary
  (a Drizzle migration + a sweep of the `'green'` query literals). Until then the split is centralised in
  `APPROVAL_LABEL` (`lib/db/types.ts`) so it doesn't ossify.
- **Per-tenant CV templates / slots.** The real-template path (`lib/cv-slots.ts`) is keyed to the seed
  owner's 11 roles; other tenants fall back to the programmatic builder. Generalise to per-owner template +
  slot config so every tenant gets template fidelity.

## Out of scope for the prototype (explicit)

Billing, automated job-lead discovery (CI #1/#8), target-company monitoring (A0), live application
tracking (D1), and a Camunda 8 runtime engine. *(Multi-tenant signup, once out of scope, shipped in
O4 — each new user gets an empty graph.)* The architecture leaves clean seams for the rest (see
[`ARCHITECTURE.md`](ARCHITECTURE.md#camunda-later)) — they are *post-prototype*.

## Sequence at a glance

```
P0 docs ─▶ P1 skeleton+data ─▶ P2 screen+score ─▶ P3 tailor+CV ─▶ P4 dashboard ─▶ P5 ship
            (read real data)     (long pole)        (long pole)      (polish)        (share)
```
