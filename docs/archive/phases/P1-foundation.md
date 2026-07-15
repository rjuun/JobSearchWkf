# P1 — Foundation: Schema, Auth & Seed

**Status:** ✅ Complete · **Goal:** a deployed-shaped, authenticated app holding the owner's
real data, read from Postgres.

> **Acceptance (met):** logging in shows `/leads` listing all **134 real leads** with company,
> JD group, requirement counts and fit scores; a lead detail renders its requirements, skill
> ratings and screening snapshot — all read from Postgres, none typed in.

---

## What was built

| Area | Implementation |
| --- | --- |
| **Database** | Full Drizzle schema (`lib/db/schema.ts`) — 24 tables + 4 enums covering the evidence side (STARs, bullet bank, skills) and the pipeline side (leads, requirements, tailoring), plus system tables (`pipeline_runs`, `llm_calls`, `ci_initiatives`). Migration generated + applied to local Postgres. |
| **DB client** | `lib/db/index.ts` — Drizzle over postgres.js, hot-reload-safe singleton. `lib/db/types.ts` holds TS unions for data-derived fields + the `RANK_WEIGHT` map used by B6. |
| **Auth** | Single-user session: `lib/auth.ts` (jose-signed cookie) + `lib/session.ts` (edge-safe shared cookie/secret) + `middleware.ts` gating every route except `/login` and `/api/ingest`. |
| **Storage** | `lib/storage.ts` — filesystem adapter (read/write text + buffers) behind a bucket-relative API that maps to Supabase Storage in prod. |
| **Seed** | `scripts/seed.ts` — imports both workbooks + captured JDs into Postgres/storage (see below). |
| **UI** | Lead board (`app/leads`), lead detail (`app/leads/[id]`), login, a dashboard stub, and shared primitives (`components/ui.tsx`, `components/app-shell.tsx`). |

## Data seeded (from the real workbooks)

```
profiles 1 · positions 6 · stars 7 · star_actions 51 · star_results 22
star_competences 18 · star_attributes 17 · responsibilities 22 · education 5
languages 4 · bullet_bank 21 · skills_master 25
companies 133 · offices 18 · jd_groups 6
job_leads 134 · job_requirements 197 · requirement_tailoring 26
cv_variants 10 · ci_initiatives 10 · jd captures 20
```

The seed is **idempotent** (truncates then re-imports) and links job requirements to leads by the
spreadsheet's `Lead: ID` (sequence number), and captured JD markdown to leads by the filename's
leading number.

## Key files

| File | Purpose |
| --- | --- |
| `lib/db/schema.ts` | The schema — single source of truth for tables/enums |
| `scripts/seed.ts` | Workbook → Postgres importer (`npm run seed`) |
| `scripts/migrate.ts` · `drizzle/` | Migration runner + generated SQL |
| `lib/auth.ts` · `lib/session.ts` · `middleware.ts` | Auth + route gating |
| `app/leads/page.tsx` · `app/leads/[id]/page.tsx` | The board + detail views |

## How it runs

```bash
# one-time: local Postgres + DB
createdb jobsearch_camunda
npm run db:generate && npm run db:migrate   # schema → tables
npm run seed                                # workbooks → data

npm run dev                                 # http://localhost:3000
```

Credentials come from `.env.local` (`APP_EMAIL` / `APP_PASSWORD`). LLM stays in `mock` mode this
phase (no pipeline yet).

## Decisions & deviations from the blueprint

- **Local Postgres + Drizzle instead of the Supabase service.** No Docker on the build machine, so
  the local demo runs against Homebrew Postgres. Supabase *is* Postgres — the same schema and
  `DATABASE_URL` point at Supabase cloud in P5 with no code change. Auth and Storage are behind
  thin adapters (`lib/auth.ts`, `lib/storage.ts`) that swap to Supabase Auth/Storage later.
- **Column-index parsing in the seed.** The workbooks have banner rows and multi-word headers; the
  importer reads by fixed column index (documented inline) rather than fuzzy header matching — more
  robust for this one-off import. `mapStatus()` heuristically maps the free-text "Process Status"
  to the `lead_status` enum.
- **RLS deferred.** Every table carries `owner_id` (one demo owner). App-layer scoping now; Supabase
  RLS policies (`owner_id = auth.uid()`) added when going multi-user.

## Simplify pass (applied)

- Extracted `lib/session.ts` so the session cookie name + signing key have **one source of truth**
  (was duplicated in `middleware.ts` vs `lib/auth.ts`/`lib/env.ts` — a real drift hazard; middleware
  can't import `lib/auth` because of `next/headers`, hence a shared edge-safe module).
- Seed now captures JDs **before** inserting leads and links on insert — removed ~20 sequential
  `UPDATE` round-trips; typed `mapStatus` → dropped an unsafe cast; uses `env.storageDir`.
- Parallelized lead-detail I/O (`Promise.all`); deduped `lib/storage` write helpers; minor null-check
  and `cn()` consistency tidy-ups.
- *Skipped (intentional):* `cn()` wrapper kept as the className-merge seam; `STATUS_STYLES` left in
  the UI layer; requirement-count query left as a grouped scan (fine at this scale).

## Verification evidence

- `npm run build` — all routes + middleware compile.
- Unauthenticated `GET /leads` → `307 → /login`.
- Authenticated `GET /leads` → renders "Lead board" + 134 lead-detail links incl. ABN AMRO, Miro,
  Western Union; a lead detail → HTTP 200 with requirements + role-fit breakdown.

## Next — P2

Wire the bookmarklet ingest + the B1–B6 screening pipeline (Anthropic client with tool-use & a
deterministic `lib/scoring`), with a pipeline console that runs a JD end-to-end to a Role Fit Score.
