# RoleProof

An **agentic job-search system** that screens job leads, scores role fit, and produces
ATS-optimised, evidence-backed CVs — turning a senior professional's career profile into
tailored applications with a human in the loop.

This repository is the **system blueprint**: the documented methodology, the AI operating
instructions, and a complete plan to turn the current document-driven workflow into a
**single-user, demo-ready SaaS prototype** (Next.js + Supabase + LLM API, deployed on
Vercel).

> **Status — live prototype.** Deployed on Vercel (`role-proof.vercel.app`) + Supabase, screening
> and tailoring end-to-end **live on DeepSeek** (with a deterministic mock fallback for offline
> demos). Beyond the original P1–P5 plan it grew through onboarding **O2–O4**, the journey-first
> redesign **M0–M7**, and **Additive A/B/C** + **Rethink D/E/F** waves.
> **Review hub:** open [`docs/archive/phases/index.html`](docs/archive/phases/index.html) in a browser. Current
> state, decisions and next phases: [`docs/RETROSPECTIVE.md`](docs/RETROSPECTIVE.md).

## Quickstart

```bash
createdb roleproof                         # local Postgres
cp .env.example .env.local                 # set APP_EMAIL, APP_PASSWORD, SESSION_SECRET
npm install
npm run db:migrate && npm run seed         # schema + your real data (gitignored)
npm run dev                                # http://localhost:3000

# headless verifiers (run in mock mode, no API key needed):
npx tsx scripts/verify-screening.ts        # B1–B6 + the deterministic Role Fit Score
npx tsx scripts/verify-tailoring.ts        # C1–C7 + a valid 2-page .docx
```

Seeding production (Supabase) uses the same scripts pointed at the cloud DB — one command is
`npm run db:deploy` (migrate → seed → demo-login). See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Demo path: **/roleproof** → **Capture a lead** (`/roleproof/capture`) → open a lead →
**Screen** → **Promote** → **Map evidence** → **Keep / Maybe / Drop** → **Generate CV** →
**Download**. Pipeline trace details are folded into the workspace panels.

---

## What the system does

A staged, gated pipeline takes a job posting from "saved link" to "tailored CV":

| Stage | What happens | Gate |
| --- | --- | --- |
| **A — Acquire** | Capture a job lead (LinkedIn → JD text) | — |
| **B — Screen** | Freshness/saturation → roadblocks → misalignments → map to a 17-dimension skills framework + JD Group + ATS → extract & rank requirements → **Role Fit & Investment Worthiness Score** | Hold if posting ≥60 days; proceed only if fit score clears the threshold |
| **C — Tailor** | (Prioritised leads only) format check → map each requirement to profile evidence → **human Keep / Maybe / Drop gate** → draft CV bullets → skills section → profile → compile 2-page CV → ATS rating | Only Keep evidence becomes CV content |
| **CI — Improve** | Every session can raise "Accuracy Improvement Tips"; a dashboard tracks ~10 improvement initiatives | — |
| **D — Monitor** | (Early) track target companies and live applications | — |

The core principle throughout: **truthfulness over optimisation** — never claim experience
the profile doesn't evidence; flag gaps honestly. Full step-by-step logic lives in
[`Process/`](Process/) and is indexed in [`docs/PIPELINE.md`](docs/PIPELINE.md).

---

## How it runs today vs. where it's going

| | **Today (manual)** | **Target (SaaS prototype)** |
| --- | --- | --- |
| Orchestration | Claude.ai project + per-step Obsidian notes, run by hand | Next.js app runs each step as a server action calling the DeepSeek API |
| Data | `Job Hunting Lists.xlsx` + `Profile_Reference_Workbook.xlsx` | Postgres (Supabase), seeded from those workbooks |
| Capture | LinkedIn bookmarklet → Power Automate → SharePoint | `/roleproof/capture` bookmarklet → signed-token `/api/ingest` → Supabase |
| CV output | Word template filled by hand | `docxtemplater` fills the 2-page template from Keep bullets |
| Camunda | (name only — no files) | BPMN diagrams as the **visual spec** of the pipeline; runtime engine is a later option |

The "Camunda" in the name reflects the long-term intent to model this gated process as
**BPMN**. For now BPMN is documentation; see [`docs/bpmn/`](docs/bpmn/).

---

## Repository structure

```
RoleProof/
├── README.md                     ← you are here
├── CLAUDE.md                     ← operating guide for Claude Code / contributors
├── docs/                         ← the documentation (see docs/README.md for the map)
│   ├── ARCHITECTURE.md           ← the as-built SaaS architecture
│   ├── DATA_MODEL.md             ← entities → Postgres schema
│   ├── PIPELINE.md               ← A→B→C→CI→D step map (ties code to Process/ notes)
│   ├── ROADMAP.md                ← build record (P0–P5 + post-P5 waves) + what's next
│   ├── DEPLOYMENT.md             ← envs, secrets, Supabase + Vercel, seeding, cost
│   ├── RETROSPECTIVE.md          ← current state, decisions, gaps
│   ├── DEMO_RUNBOOK.md           ← the 5-minute demo click-path
│   ├── design/                   ← design system, onboarding + user-journey specs
│   ├── bpmn/                     ← BPMN visual spec + Camunda-later migration path
│   ├── reference/                ← misc reference (style guide, field instructions)
│   └── archive/                  ← frozen build-log: per-phase/milestone/wave review pages
│
│  # ───── application code ─────
├── app/ · lib/ · components/     ← Next.js app · domain logic (db, pipeline, scoring, docx) · UI
├── drizzle/ · scripts/ · middleware.ts
│
├── Process/                      ← TRACKED: the methodology (A1, B1–B6, C1–C7, CI, D)
│   ├── + Job Hunting Master Instructions.md
│   ├── + Continuous Improvement Procedure.md / Dashboard.md
│   ├── A1 / B1–B6 / C1–C7 step notes
│   └── CI/  Development/  Past Versions/
├── Claude_Project_Instructions.md  ← TRACKED: AI agent operating contract
│
│  # ───── gitignored: personal career data (becomes SaaS seed data) ─────
├── Profile/                      ← profile docs, fact sheets, Profile_Reference_Workbook.xlsx
├── Group CVs/                    ← CV template + role-targeted variants (.docx)
├── Job Descriptions/             ← ~25 captured postings (.md)
└── Job Hunting Lists.xlsx        ← the application tracker (6 sheets)

# Also gitignored & kept local only (not in the repo): design-input / handoff folders
# videos/ · redesign_2/ · roleproof-ux-redesign/
```

**Privacy:** personal data (CVs, profile, the tracker, captured JDs) is **never committed** —
it is excluded via [`.gitignore`](.gitignore). The repo is the *system*; your data stays local.
When the app is built, those workbooks become gitignored seed data (see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)).

---

## Target tech stack

- **Frontend/Backend:** Next.js (App Router, TypeScript) — pipeline steps run as server actions
- **Database/Storage:** Supabase (Postgres + a private Storage bucket). **Auth is self-contained** —
  a `jose`-signed session cookie + `scrypt` over a `users` table (`lib/auth.ts`), **not** Supabase
  Auth, and **no RLS**; every query is owner-scoped in the app layer (`currentOwnerId()`, fail-closed)
- **AI:** DeepSeek API (OpenAI-compatible) — a chat tier for extraction and a scoring tier; structured output via forced function calls
- **CV generation:** `docxtemplater` filling the existing 2-page Word template
- **Hosting:** Vercel
- **Process spec:** BPMN (Camunda Modeler) — documentation now, optional Camunda 8 runtime later

---

## Documentation map

Start here, then read in this order:

1. [`docs/PIPELINE.md`](docs/PIPELINE.md) — the domain process, step by step
2. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — the data the system operates on
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it's built
4. [`docs/ROADMAP.md`](docs/ROADMAP.md) — the build sequence
5. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — how it ships

For working *in* this repo (conventions, non-negotiables, model-per-step), read
[`CLAUDE.md`](CLAUDE.md).
