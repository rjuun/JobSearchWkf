# Architecture — SaaS Prototype (as built)

> A **single-user, demo-ready** prototype that runs the full A→B→C pipeline, seeded with the
> owner's real data and polished enough to screen-share. **Status: built and live** on Vercel at
> `role-proof.vercel.app`. Schema and the owner-scoping layer are multi-user-capable, so opening it
> up later is a clean step, not a rewrite.

## Stack & topology

Next.js (App Router, TypeScript) on **Vercel** + **Supabase** (Postgres + a private Storage bucket)
+ **DeepSeek** (an OpenAI-compatible LLM API). Auth is **self-contained** — a `jose`-signed HS256
session cookie over a `users` table with `scrypt` hashing (`lib/auth.ts`), **not** Supabase Auth —
so Supabase is only a database and a file bucket (no RLS policies, no Auth providers). Every
read/write is scoped in the app layer by `currentOwnerId()`, which fails closed. **No separate
queue/worker service** — a single-user demo has no concurrent load that justifies Redis/BullMQ, and
Vercel's serverless model fights long-lived workers.

- **Pipeline steps run as Next.js Server Actions** (UI-triggered DB mutations) plus a few
  **Route Handlers** (`app/api/.../route.ts`) for the two things server actions handle poorly:
  (a) the bookmarklet ingest endpoint (needs CORS + a stable URL), and (b) streaming token output.
- **Long steps stay within serverless limits by being chunked per lead / per requirement.**
  Every step is **idempotent and resumable**: a `pipeline_runs` row records `step`, `status`,
  `input_hash`, `output_jsonb`. The client advances a small state machine, which also gives
  progress UI for free. (This same state machine is the seam for a future Camunda 8 engine — see
  [Camunda-later](#camunda-later-migration-path).)

```
Browser (LinkedIn)                          Next.js on Vercel
  └─ bookmarklet ──POST JD md──▶ /api/ingest (Route Handler, CORS)
                                     │ store raw md → Storage; insert JobLead(draft)
  React UI (App Router) ◀───────────┤
   lead board / pipeline console     │ Server Actions: runB1..B6, runC1..C7
   C2 Keep/Maybe/Drop gate            │   each → llm.runStructured(stepId, {context, schema})
   CV preview + download              │   → validate (Zod) → write entities → pipeline_runs
                                     ▼
       Supabase: Postgres (owner-scoped in app) + Storage bucket (jd-captures/, cv-output/)
                                     ▲
                          DeepSeek API (extraction + scoring tiers, forced function-call JSON)
```

## Repository structure

```
/app
  /roleproof                  # board
  /roleproof/capture          # manual paste + signed bookmarklet generator
  /roleproof/leads/[id]       # workspace, C2 gate, C6 CV download
  /api/ingest/route.ts        # bookmarklet endpoint (POST, CORS)
/lib
  /pipeline                   # one module per step (screening.ts, tailoring.ts …)
  /llm                        # LLM choke point (provider is DeepSeek)
    client.ts                 # runStructured(): model-per-step, forced tool-call, retries, token logging
    schemas.ts                # Zod/JSON schemas per step — the output contract
  /scoring                    # PURE deterministic functions: rollups, weighted averages, gates
  /docx                       # CV compiler (docxtemplater) + templates/
  /db                         # Drizzle schema + typed query helpers (postgres.js)
  auth.ts                     # self-contained session cookie (jose) + scrypt password hashing
/drizzle                      # journaled SQL migrations (drizzle-kit)
/scripts                      # migrate.ts, seed.ts, reset.ts, reset-demo-login.ts (run locally)
/docs                         # this blueprint
```

## How a pipeline step calls the LLM (DeepSeek)

A single choke point, `lib/llm/client.ts → runStructured({step, model, …})` (provider is DeepSeek):

1. **Selects the model tier** from a per-step map — an extraction tier for B1–B5 / C2–C5 and a
   scoring tier for B6 / C7 (per the Master Instructions §7.1). Resolve model IDs from env
   (`DEEPSEEK_MODEL` / `DEEPSEEK_MODEL_REASON`, both `deepseek-chat` today) rather than hardcoding.
2. **Builds the prompt**: the step's `Process/*.md` note as the system prompt + a shared
   non-negotiables preamble (truthfulness / ATS / anti-sycophancy from the Master Instructions §1).
3. **Forces structured output via tool-use**: one tool per step (e.g. `emit_role_fit_scores`)
   with a strict JSON Schema, `tool_choice` set to that tool. The model *must* call it; the tool
   `input` is the result — far more reliable than "return JSON" in prose.
4. **Validates** the tool input with **Zod** server-side; on failure, one bounded retry with the
   validation error fed back.
5. **Logs** `model`, token counts, `step`, `lead_id` to an `llm_calls` table (cost + audit trail).

### Determinism rule (the important one)

The LLM emits **judgments only**. All **arithmetic and gates are TypeScript** in `lib/scoring`:

- **B6 overall** = `0.35·relevance + 0.20·seniority + 0.20·impact + 0.15·reqAlign + 0.10·ats`.
- **reqAlign** = `Σ(score·weight) / Σ(weight)` over requirements, with Core=3 / Important=2 / Nice=1.
- **Recommendation tier** (Proceed / Caution / Low / Not recommended) from thresholds code owns.
- **B1 gate**: parse days-since-publication from the captured header line; `≥60 days` → auto-flag *hold*.

Results are **persisted and never recomputed on read**, so re-running B6 with the same inputs and
the same `bullet_bank_version` yields the same number (B6's spec mandates recording that version).

## Data: Postgres + Storage

- **Postgres** holds every entity (see [`DATA_MODEL.md`](DATA_MODEL.md)). Every table carries
  `owner_id uuid`; isolation is enforced **in the app layer** — every query is scoped by
  `currentOwnerId()` (derived from the signed session cookie), which **fails closed** (throws) when
  there is no valid session. There are **no RLS policies** (Supabase Auth is not used). For the demo
  there is one user; going multi-user later means simply no longer seeding a fixed `owner_id`.
- **Storage** — one private bucket (`jobsearch`) with path prefixes: `jd-captures/{leadId}/raw.md`
  (bookmarklet output, the B-phase source) and `cv-output/{leadId}/{variant}.docx`. The adapter
  (`lib/storage.ts`) uses Supabase Storage when configured, else the local filesystem. UI fetches
  via short-lived signed URLs.

## .docx generation {#docx}

**Use `docxtemplater` (+ `pizzip`) to fill the existing template — not the programmatic `docx`
builder, and not raw XML string-replace.**

The strict 2-page template already exists (`Group CVs/CV_Template.docx`) with `<< CV Position >>`
placeholders and invariant sections (Education / Executive Education / Languages). Rebuilding that
layout in code would discard the owner's careful formatting and reintroduce the 2-page-fidelity
problem on every change. Word also **fragments placeholders across runs** (the raw XML shows
`<<P rofessional Experience…>>`), so naïve string replacement fails — `docxtemplater` normalises
runs before resolving tags, which solves exactly this.

Approach:
1. **Re-tag the template once** from `<< … >>` to `docxtemplater` syntax (`{cv_a1_project}`,
   loops `{#bullets}…{/bullets}`), keyed to the `cv_position` enum. Verify with a render test on
   day one of phase P3 before building the rest of C.
2. At compile time, assemble a render model from **Keep** `requirement_tailoring` rows
   grouped by `cv_position`, plus the C5 profile and C4 skills, applying C6's space rules **in code**
   (Profile ≤5 lines; Skills ≤4 categories ×5; only Core/Important bullets; drop a project with no
   Core/Important bullet).
3. Render → `.docx` → Storage. Optionally render a **PDF preview** via headless LibreOffice
   (`soffice --convert-to pdf`) so the 2-page result is visible in-app. LibreOffice on Vercel
   serverless is heavy — treat the PDF preview as best-effort; the `.docx` is the real deliverable,
   and the content budget (not page measurement) is what keeps it to 2 pages.

## One full lead lifecycle

```
1. CAPTURE  /roleproof/capture bookmarklet → POST /api/ingest {md, sourceUrl, captureToken}
            → Storage raw.md; INSERT job_leads(status='captured'); upsert company/office
2. B-SCREEN "Screen" on the lead
   B1 parse header (days, applicants) in code → freshness/saturation; ≥60d → status='hold'
   B2 LLM → roadblocks {language, tech, cert, geo, industry}
   B3 LLM → misalignments (context: Values & Motives Summary)
   B4 LLM → 17 skill ratings (A–Q) + JD group primary/secondary + ATS system
   B5 LLM → requirements[] (order, rank Core/Important/Nice, skills)
   B6 LLM (scoring tier) → 5 dimension scores + per-requirement match+score
              → lib/scoring computes reqAlign, overall, recommendation tier  (DETERMINISTIC)
3. B6 GATE  UI shows score + tier. Proceed/Caution → user promotes to Tailoring; Low/No → stop.
4. C-TAILOR (promoted leads only)
   C1 format/compliance + headshot decision (country/DEI tree)
   C2 evidence map[] (requirement → evidence ref + original_text + cv_position), status='pending'
      → USER reviews each: Keep / Maybe / Drop
   C3 CV bullets — ONLY over Keep rows (7 principles)
   C4 skills section (≤4 cats); C5 profile (≤5 lines)
   C6 docxtemplater fills CV_Template → cv-output/{lead}/{variant}.docx (+ PDF preview)
   C7 LLM (scoring tier) → ATS rating (0–100)
5. DOWNLOAD preview PDF in-app, download .docx; (later) log an Application row.
```

## Key risks & decisions

| Risk / decision | Resolution |
| --- | --- |
| **.docx 2-page fidelity** (highest risk) | `docxtemplater` fills the existing template; enforce 2 pages by content budget (C6 rules) in code, not by measuring. Re-tag template once; render-test on P3 day one. |
| **Agent determinism & cost** | Tool-use with forced schema + Zod + one retry; all arithmetic in TS; persist results, never re-score on read; prompt-cache the long step notes; log every call. |
| **Human-in-the-loop (C2)** | `approval_status` enum on `requirement_tailoring`; per-row review queue; only Keep flows to C3. Build this UI well — it's the demo centrepiece. |
| **Prompt management** | `Process/*.md` notes *are* the prompt templates, loaded at runtime. Refining a step = editing markdown, no code change. Keeps the CI "Accuracy Improvement Tips" loop meaningful. |
| **Vercel function duration on batch B6** | Per-lead chunking already mitigates. For full-batch scoring, run a manual local script against prod rather than building worker infra. |

## Camunda-later migration path {#camunda-later}

BPMN is **documentation-only now** (`docs/bpmn/`). But the topology above deliberately models each
step as an **idempotent, resumable unit** with a `pipeline_runs` state machine and explicit gates
(B1 freshness, B6 fit) — that *is* a process graph. Migrating to **Camunda 8 (Zeebe)** later means
mapping each step module to a job worker and each gate to a BPMN gateway; orchestration moves to
Zeebe while the step code (LLM calls + scoring) stays. Designing the state machine now is
what makes that a swap rather than a rewrite.

---

*See [`DATA_MODEL.md`](DATA_MODEL.md) for the schema, [`PIPELINE.md`](PIPELINE.md) for per-step
specs, and [`ROADMAP.md`](ROADMAP.md) for the build sequence.*
