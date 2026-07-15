# Deployment & Operations

How the prototype is hosted, seeded, secured, and what it costs.

The shipped stack is **Vercel (Next.js app) + Supabase (Postgres + Storage) + DeepSeek**.
Auth is **self-contained** — a `jose`-signed session cookie over a `users` table with `scrypt`
password hashing (`lib/auth.ts`), *not* Supabase Auth. So Supabase here is only a database and a
file bucket; there are no RLS policies or Auth providers to configure. Every read/write is scoped in
the app layer by `currentOwnerId()`, which fails closed (throws) when there is no valid session.

## Environments

| Env | Hosting | Database | Purpose |
| --- | --- | --- | --- |
| **local** | `npm run dev` | local Postgres | day-to-day development |
| **preview** | Vercel preview (per branch) | the production Supabase project | review changes before prod |
| **production** | Vercel prod | a Supabase project (seeded with real data) | the shareable demo |

A single Supabase project is enough for the demo. Reset the demo tenant any time with
`npm run db:reset` (owner-scoped — see [Operational notes](#operational-notes)).

## Secrets

Set these in the Vercel project (Production scope). All are **server-side only** — none is
`NEXT_PUBLIC_*`, and the DeepSeek and service-role keys must never reach client code.

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Supabase **pooled** connection (host `…pooler.supabase.com`, port **6543**) | The app runtime. The client auto-disables prepared statements on the pooler (pgbouncer rejects them). |
| `SESSION_SECRET` | `openssl rand -hex 32` | Signs the session + capture-token cookies. |
| `DEEPSEEK_API_KEY` | your DeepSeek key | The only real cost driver. `LLM_MODE=live` (default) uses it; absent → safe mock fallback. |
| `LLM_MODE` | `live` | `mock` forces deterministic fixtures (offline demos). |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Storage endpoint. |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role secret | **Server only.** Used by the storage adapter + seed. **Never** `NEXT_PUBLIC_*`. |
| `SUPABASE_BUCKET` | `jobsearch` | Must match the private bucket you create. |

Do **not** set `DIRECT_URL` in Vercel — that variable is for CLI scripts only (see Seeding). Locally
these all live in `.env.local` (gitignored); `.env.example` documents every one.

## 1 · Supabase (database + file storage)

1. Create the project at [supabase.com](https://supabase.com). Pick a region near you (EU / Frankfurt
   for Vienna). Save the **database password**.
2. **Storage → New bucket** → name it **`jobsearch`**, keep it **Private**. JD captures and generated
   CVs are stored under path prefixes inside this one bucket (`jd-captures/…`, `cv-output/…`).
3. Collect four values:
   - *Project Settings → Database → Connection string → Transaction pooler* (port **6543**) → `DATABASE_URL`.
   - Same page → **Direct connection** (port **5432**) → `DIRECT_URL` (scripts only).
   - *Project Settings → API → Project URL* → `SUPABASE_URL`.
   - *Project Settings → API → `service_role` secret* → `SUPABASE_SERVICE_ROLE_KEY`.

The storage adapter (`lib/storage.ts`) switches to Supabase Storage automatically whenever
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are present; otherwise it uses the local filesystem
(`STORAGE_DIR`). Vercel's filesystem is ephemeral, so the bucket is required in production.

## 2 · Vercel (the app)

1. *Add New → Project → Import Git Repository* → pick the repo. Framework auto-detects as **Next.js**;
   leave build settings at defaults (`next build`). The build does not touch the database, so it
   succeeds even before the schema exists.
2. Add the [Secrets](#secrets) above (Production scope) **before** the first deploy.
3. **Deploy.** Share the `*.vercel.app` URL, or add a custom domain.
4. The whole app is gated by `middleware.ts` (public allowlist: `/login`, `/signup`, `/api/ingest`,
   `/api/health`, `/p/` proof links). A shared link therefore shows a **login screen** — that gate is
   the access control for the demo.

Heavy LLM pages already declare `export const maxDuration = 60` (the leads workspace, story, and
onboarding), which their server actions inherit. Vercel Hobby permits 60s, so no plan upgrade is
needed for the demo.

## 3 · Migrate + seed production {#seeding}

Schema and the owner's **real** demo data are loaded by running the committed scripts **locally,
pointed at the production database**. Never run them in CI/Vercel. Inline env vars win over your
`.env.local` (the loader only fills unset keys), so this does not disturb local dev.

```bash
# create/upgrade the schema — uses the DIRECT (non-pooled) connection for DDL
DIRECT_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  npm run db:migrate

# load the demo tenant + create the demo login; uploads JDs + CVs to the bucket
DIRECT_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
SUPABASE_URL="https://<ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
SUPABASE_BUCKET="jobsearch" \
APP_EMAIL="you@example.com" \
APP_PASSWORD="<pick-a-demo-password>" \
  npm run seed
```

Or run both (schema → data → login) in one shot — same inline env, ending with a login round-trip check:

```bash
DIRECT_URL="…:6543/postgres" SUPABASE_URL="…" SUPABASE_SERVICE_ROLE_KEY="…" \
SUPABASE_BUCKET="jobsearch" APP_EMAIL="you@example.com" APP_PASSWORD="<demo-password>" \
  npm run db:deploy        # = db:migrate → seed → db:demo-login (verifies the login)
```

- **Why `DIRECT_URL`:** migrations and bulk seeding need prepared statements + session features that
  Supabase's transaction pooler rejects. `db:migrate`, `seed`, and `db:reset` all prefer `DIRECT_URL`
  when present; the Vercel app uses the pooled `DATABASE_URL`.
- **The demo login is `APP_EMAIL` / `APP_PASSWORD`** as passed to the seed — those bake into the
  `users` table as Reggie's account. The seed **upserts** it, so every seed re-syncs the login to the
  credentials you pass (a fresh password takes effect immediately). To fix *only* the login without a
  full reseed, run `DIRECT_URL="…" APP_EMAIL="…" APP_PASSWORD="…" npm run db:demo-login` — it rewrites
  the credentials and verifies the password round-trips. **A code deploy (Vercel) never touches this**;
  the login only changes when you seed, so it can't drift on a redeploy.
- **Prerequisite:** the gitignored workbooks + JD/CV folders must be present locally (the seed reads
  them). A machine without them cannot seed or reset — inherent to "restore my real demo data."
- **`scripts/seed.ts` reads:**
  - `Profile_Reference_Workbook.xlsx` → `positions`, `stars`, `star_*`, `responsibilities`,
    `education`, `languages`, `bullet_bank`, `skills_master`.
  - `Job Hunting Lists.xlsx` → `companies`, `offices`, `jd_groups`, `job_leads`, `job_requirements`,
    `requirement_tailoring` (Job Leads headers are on **row 2** — row 1 is a banner).
  - `Job Descriptions/*.md` → uploaded to `jd-captures/{leadId}/raw.md`, linked to the matching lead.
  - `Group CVs/*.docx` → seed `cv_variants`, uploaded to `cv-output/…`, linked by archetype.
- **Idempotent & owner-scoped:** the seed wipes only the demo owner's rows
  (`DEMO_OWNER_ID = 00000000-…-0001`) then rebuilds, so it never touches experimental users.

## 4 · Smoke test

- `GET /api/health` → expect `{"ok":true,"db":"up","storage":"supabase","llm":"live"}`.
- Open the root URL → the login gate appears → sign in with the seed credentials → Reggie's board loads.

## Cost expectations

- **DeepSeek (usage-based) — the only meaningful cost.** Screening one lead ≈ 5 extraction calls + 1
  scoring B6 call; tailoring ≈ several extraction calls + 1 scoring C7. DeepSeek is inexpensive, so a
  fully processed lead is well under a cent to a few cents. A demo (a few live leads + seeded results)
  is **negligible**. Results persist and are **never re-scored on read**.
- **Supabase:** free tier (500 MB DB, 1 GB storage) comfortably covers ~140 leads + ~10 CVs.
- **Vercel:** Hobby/free tier is fine for a single-user demo.

## Operational notes {#operational-notes}

- **Resetting the demo:** `npm run db:reset` (same `DIRECT_URL` + Supabase env prefix as seeding) snaps
  the demo tenant back to baseline **owner-scoped** — experimental users you sign up are left intact.
- **Adding experimental users:** sign up at `/signup`; each new user gets an empty graph and sees only
  their own data. A reseed/reset never contaminates them.
- **Cost/usage visibility:** the `llm_calls` table powers a dashboard panel — watch it during demos.
- **LibreOffice PDF preview** (optional, for the in-app 2-page preview) is heavy on Vercel serverless —
  treat as best-effort; the `.docx` is the real deliverable.
