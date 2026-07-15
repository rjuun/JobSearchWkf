# P4 — Dashboard & Polish

**Status:** ✅ Complete · **Goal:** a dashboard that tells the pipeline's story at a glance, plus
demo-grade polish (loading, error, empty states).

> **Acceptance (met):** `/dashboard` (HTTP 200) renders leads-by-stage, the role-fit distribution,
> the ~10 CI initiatives, an Accuracy-Improvement-Tips capture surface, and the AI-usage panel —
> all from live data.

---

## What was built

| Area | Detail |
| --- | --- |
| **Leads by stage** | A funnel of lead counts across the pipeline statuses (captured → … → applied). |
| **Role-fit distribution** | Leads bucketed by recommendation tier (Proceed / Caution / Low / Not recommended / Unscored). |
| **Continuous improvement** | The ~10 CI initiatives seeded from `Process/CI/*.md`, with status + priority — the Obsidian dashboard, in-app. |
| **Accuracy Improvement Tips** | A live capture form (Type · Where · Observation · Suggested action) + a resolvable list — closing the improvement loop the system is built around. |
| **AI usage** | Pipeline-run count, LLM call count (and how many were live), and total tokens — from `pipeline_runs` + `llm_calls`. |
| **Polish** | Per-route loading skeletons, a global error boundary (`app/error.tsx`) with retry, a styled 404, and empty states throughout. |

All dashboard data is gathered in one parallel fetch, `getDashboardData()` in `lib/queries.ts`.

## The improvement loop, closed

The system's whole premise is that accuracy compounds: every application teaches the next. P4 makes
that tangible — an **Accuracy Improvement Tip** raised during work becomes an `accuracy_tips` row on
the dashboard, reviewable and resolvable. It mirrors the `Process/`-based CI procedure the owner
already runs by hand.

## Verification evidence

```
GET /dashboard (authed) → 200
  Leads by stage ✓   Role-fit distribution ✓   Continuous improvement ✓ (CI titles present)
  Accuracy improvement tips ✓   Pipeline runs / LLM usage ✓
ready-lead detail → Tailoring panel ✓  Download CV ✓
GET /api/cv/<lead> → 200  application/vnd…wordprocessingml.document  8727 bytes
```

## Simplify pass (applied)

- Hoisted the duplicated `Stat` metric tile into `components/ui.tsx` (it lived in both the leads and
  dashboard pages with diverging signatures) — one component, `number | string` value.
- *Left as-is (noted):* the two bar-row renderers and the two loading skeletons differ enough that a
  shared component isn't worth it yet.

## Recorded for the retrospective

- `getDashboardData()` fetches all `llm_calls` and aggregates in JS — fine at prototype scale; push
  the token sum / live-call count into SQL once volumes grow.

## Next — P5

Deploy hardening: the Supabase-cloud mapping (Postgres URL, Auth, Storage), Vercel config, secrets,
whole-app auth gating, the seed-against-prod procedure, and the live-LLM switch — everything the
owner needs to share a URL.
