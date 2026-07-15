# Retrospective — Decisions, Gaps & Future Phases

A technical account of the prototype. **Sections 1–6 below are the P5-era snapshot** (end of the
original P1–P5 plan), preserved for history — several of their "gaps" and "future phases" have since
shipped. **Read the Update immediately below first; it supersedes anything stale.** The friendly
visual version is
[`docs/archive/phases/retrospective.html`](archive/phases/retrospective.html); per-phase write-ups are in
[`docs/archive/phases/`](archive/phases/) (and indexed at [`archive/phases/index.html`](archive/phases/index.html)).

---

## 0. Update — current state (supersedes the P5-era snapshot below)

Since the P1–P5 snapshot, the prototype went **live** and grew through several waves:

- **Live, not mock.** Deployed on Vercel (`role-proof.vercel.app`) + Supabase; the LLM path runs
  **live on DeepSeek** by default (`LLM_MODE=live`), with the deterministic mock as an offline
  fallback. Provider is **DeepSeek** (OpenAI-compatible) — not the Anthropic SDK.
- **Self-contained auth (shipped).** `jose` session cookie + `scrypt` over a `users` table
  (`lib/auth.ts`), owner-scoped in the app layer. **No Supabase Auth, no RLS** — so the
  "P7 multi-tenant = Supabase Auth + RLS" row below is not how it went.
- **Multi-tenant signup shipped (O2–O4).** `/signup` gives each new user an empty career graph;
  onboarding extracts a career graph and runs a coaching loop.
- **Real-template CV shipped.** `docxtemplater` fills the owner's 2-page template
  (`Group CVs/CV_Template.docx`) via `lib/cv-slots.ts`, with the programmatic builder as fallback —
  superseding the "programmatic only" decision and the matching "should deepen" note below.
- **Redesign + additive waves.** Journey-first redesign **M0–M7**, **Additive A/B/C** (interview
  brief, Discover, Excavation, Proof Link, coverage/compass), **Rethink Completion D/E/F**.
- **Tests exist now.** A **pure** Vitest suite (**92 passing**, no DB/network/LLM), beyond the three
  headless verifiers noted below.

Per-wave detail is in [`docs/archive/`](archive/README.md); live-ops (deploy/seed/demo-login) in
[`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## 1. What was built

A **single-user, demo-ready SaaS prototype** of the agentic job-search system — runnable locally,
Supabase/Vercel-ready, seeded with the owner's real data.

| | |
| --- | --- |
| **Stack** | Next.js 14 (App Router, TS) · Postgres + Drizzle · Anthropic SDK · `docx` · Supabase-ready · Tailwind |
| **Pipeline** | A1 capture · **B1–B6** screening (reproducible Role Fit Score) · **C1–C7** tailoring (human-gated) → 2-page `.docx` |
| **Data** | 24 tables seeded from the real workbooks: 134 leads, 197 requirements, 51 STAR actions, 25 skills, 26 tailoring examples, 10 CI items |
| **Surfaces** | Auth, lead board, lead detail + pipeline console, tailoring approval (Keep/Maybe/Drop), CV download, CI dashboard |
| **Verified** | Build + typecheck green every phase; 3 headless verifiers (screening rollup, tailoring CV, runtime smoke) |

Everything ran in **mock LLM mode** (deterministic fixtures), so the whole pipeline demos with no
API key. The live path (real Claude calls) is wired and switches on by env.

## 2. Key decisions

| Decision | Why | Alternative / later |
| --- | --- | --- |
| **Local Postgres + Drizzle** (not the Supabase service locally) | No Docker on the build machine; Supabase *is* Postgres, so the same schema/URL point at the cloud unchanged | Supabase local stack (needs Docker) |
| **Mock-first LLM** with a deterministic fixture per step | Run + verify the whole pipeline offline, with no key; reproducible demos | Live-only (needs a key to do anything) |
| **LLM judges, code computes** | The B6 Role Fit Score must be reproducible — the model emits 0–10 judgments, `lib/scoring.ts` does all arithmetic | Let the model return the overall (non-reproducible) |
| **`Process/*.md` notes as prompts** | Refining a step = editing markdown, not code; keeps the CI loop meaningful | Hardcode prompts in code |
| **Human-gated C2** (Green/Yellow/Red) | The differentiator — only approved, evidenced claims reach the CV | Auto-generate the CV (loses trust) |
| **Custom single-user auth**, app-layer `owner_id` scoping | Simplest path to a gated demo without Supabase Auth/GoTrue | Supabase Auth + RLS (the multi-user step) |
| **Programmatic `docx`** (not docxtemplater on the owner's template) | Fully reliable, no binary template to re-tag | docxtemplater on the real template (preserves exact formatting) |
| **Pluggable storage** (filesystem ↔ Supabase by env) | Vercel's filesystem is ephemeral; local stays simple | — |

## 3. Gaps & missing elements

### Deliberately out of scope (prototype boundary)
- **Multi-tenant signup** — built single-user; schema carries `owner_id` for a clean later step.
- **D-phase** (post-application + target-company monitoring: A0, D1) — not built.
- **Automated job-lead discovery** (CI #1 / #8) — capture is manual (bookmarklet + paste).
- **B7 summary step** and **cover-letter generation** — not built.
- **Camunda 8 runtime** — BPMN remains documentation (Mermaid in `PIPELINE.md`; no `.bpmn` authored yet).

### Simplifications that should deepen
- **CV generation** is programmatic, single "Selected Achievements" section — should fill the owner's
  template via docxtemplater and **group bullets by role/position**.
- **C7 ATS rating** is a deterministic coverage metric — should be an **Opus** ATS-match judgment.
- **C2 evidence match** is token-overlap in mock — the live path should use the Sonnet C2 prompt.

### Data-model gaps
- **`skill_category` not stored** — C4 groups by proficiency instead of the intended 3–5 categories.
- **C7 rating + ATS breakdown not persisted** — shown post-generation but not stored on the lead.
- **`applications` table unused** — no application records logged yet.

### Operational
- **Live LLM unexercised** (no key here) — prompts/tool-use need a real-API pass to tune.
- **RLS policies not written** — app-layer scoping only (fine for single-user).
- **No automated tests** beyond the 3 headless verify scripts — no unit tests for `lib/scoring`, no e2e.
- **Bookmarklet host hardcoded** to `localhost:3000` — change per deployment.
- **Cost panel** reflects B-step LLM calls only (C-steps run as code/mock).

## 4. Pending / known issues

- Re-running screening on a lead with no seeded requirements **inserts** extracted ones (idempotent
  on re-run, but worth noting it mutates).
- `getDashboardData()` aggregates all `llm_calls` in JS — move to SQL aggregates once volume grows.
- The seed maps a free-text "Process Status" to the `lead_status` enum heuristically — verify on new
  data shapes.

## 5. Suggested future phases

| Phase | Focus | Headline deliverables |
| --- | --- | --- |
| **P6 — Go live** | Enable the real LLM | Set the key; run B/C on real JDs; tune the step prompts; compare mock vs live; add prompt caching |
| **P7 — Multi-tenant** | Open it up | Supabase Auth + RLS (`owner_id = auth.uid()`); per-user onboarding; profile import wizard |
| **P8 — CV fidelity** | Match the owner's standard | docxtemplater on the real template; per-role grouping; cover-letter (C-letter) generation; PDF preview |
| **P9 — Proactive** | Feed the funnel | D-phase application tracking; target-company monitoring; automated, values-aligned lead discovery |
| **P10 — Orchestration (opt.)** | True to the name | Camunda 8 (Zeebe) runtime — map step modules to job workers, gates to BPMN gateways |
| **Cross-cutting** | Confidence | Unit tests for `lib/scoring`; e2e smoke; store C7/ATS + application records; `skill_category` column; richer cost/trace observability |

## 6. How to run & verify

> **Superseded** — for current commands and routes see [`../README.md`](../README.md) and
> [`DEPLOYMENT.md`](DEPLOYMENT.md) (`npm run db:deploy`; the board is `/roleproof`). The block below
> is the P5-era path, kept for history.

```bash
createdb jobsearch_camunda
npm install
npm run db:migrate && npm run seed        # schema + real data
npm run dev                                # http://localhost:3000  (login via .env.local)

# headless verifiers (mock mode, no API key):
npx tsx scripts/verify-screening.ts        # B1–B6 + deterministic rollup
npx tsx scripts/verify-tailoring.ts        # C1–C7 + valid 2-page .docx
```

Demo path in the UI: **/leads** → open a lead → **Run screening** → **Promote** → **Map evidence** →
approve (Keep) → **Generate CV** → **Download**. The **/dashboard** tells the whole story.
