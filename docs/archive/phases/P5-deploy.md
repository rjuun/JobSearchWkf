# P5 — Deploy Hardening & Share Prep

**Status:** ✅ Code-ready (cloud provisioning is the owner's step) · **Goal:** everything needed to
put the prototype behind a shareable URL.

> **Acceptance:** the app is Supabase/Vercel-ready — storage switches to Supabase Storage by env, a
> health probe exists, secrets are server-only, and a concrete runbook takes it from local to a
> shared, auth-gated URL. (Provisioning Supabase/Vercel requires the owner's accounts.)

---

## What changed for production

| Hardening | Detail |
| --- | --- |
| **Pluggable storage** | `lib/storage.ts` uses **Supabase Storage** when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set (Vercel's filesystem is ephemeral), else the local filesystem. Same API both ways. |
| **Health probe** | `GET /api/health` (public) → `{ ok, db, storage, llm }`, 200/503 — for uptime checks and a quick "is prod wired right" glance. |
| **Function duration** | `maxDuration = 60` on the lead-detail segment so on-page screening/tailoring fit Vercel's limit. |
| **Secrets discipline** | Service-role + Anthropic keys are server-only; the session cookie is `secure` in production; all LLM calls are server-side. |
| **Live LLM switch** | `LLM_MODE=live` + `ANTHROPIC_API_KEY` flips every step from mock fixtures to real Claude calls — no code change. |

## Deploy runbook

1. **Supabase project** → copy the Postgres connection string into `DATABASE_URL`; create a private
   Storage bucket (default name `jobsearch`); set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_BUCKET`.
2. **Schema** → `npm run db:migrate` against the prod `DATABASE_URL`.
3. **Seed** (one-off, locally, with the prod env) → place the two workbooks at their known paths and
   `npm run seed`. Real career data goes straight to prod Postgres + the Storage bucket.
4. **Secrets** → set `APP_EMAIL`, `APP_PASSWORD`, a strong `SESSION_SECRET` (`openssl rand -hex 32`),
   `LLM_MODE=live`, `ANTHROPIC_API_KEY` in Vercel env (per environment).
5. **Vercel** → import the repo (Next.js auto-detected), add env vars, deploy.
6. **Share** → add a custom domain; the whole app is already gated behind the login middleware, so a
   shared link shows a sign-in wall. Hit `/api/health` to confirm `db: up`.

## Verified locally vs. requires the owner's cloud

- **Verified here:** typecheck + build with the Supabase client bundled; the filesystem storage path
  (CV still generates and downloads); the health route compiles and is registered.
- **Requires the owner's accounts:** the live Supabase Storage round-trip, the live Anthropic calls,
  and the Vercel deploy. The code paths are in place and selected by env.

## Decisions / deviations recorded

- **Drizzle migrations**, not the Supabase CLI (`supabase db push`) — consistent with the local
  Postgres dev setup; Supabase is just the Postgres host.
- **Custom single-user auth**, not Supabase Auth (GoTrue). The app connects to Postgres with a
  privileged role, so **RLS is not the enforcement boundary yet** — app-layer `owner_id` scoping is.
  Going multi-user means adopting Supabase Auth + RLS policies (the schema already carries `owner_id`).

## Cost

Anthropic (usage-based) is the only real cost — single-digit dollars for a demo (a few live leads +
seeded results); Supabase + Vercel free tiers are comfortable at this scale. Mitigated by prompt
caching the long step notes and never re-scoring on read.

## Simplify pass (applied)

Extracted `sbUpload` / `sbDownload` helpers in `lib/storage.ts` to dedup the Supabase
upload/download+error patterns across the four read/write functions.
