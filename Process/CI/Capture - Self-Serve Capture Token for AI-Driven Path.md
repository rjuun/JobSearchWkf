---
ci-area: Capture
ci-title: Self-Serve Capture Token for AI-Driven Path
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-07-23
ci-estimated-time:
ci-time-spent:
pr-source: "[[A1. Capture and Store Job Leads]]"
pr-target:
---
---
```simple-time-tracker
{"entries":[]}
```
---
## 1. What is the problem or opportunity?

`/api/ingest` requires a signed capture token (`verifyCaptureToken`, `lib/auth.ts`), and `createCaptureToken(ownerId)` already exists to mint one — but nothing in the app ever calls it. There's no route and no UI affordance that hands an agent (or the user) a token.

Found running the AI-driven capture path end-to-end for the first time (2026-07-23, AWS "Abteilungsleitung Strategie und Corporate Governance" posting via LinkedIn → Playwright). To get a token at all I had to write a throwaway script (`scripts/_tmp-mint-capture-token.ts`, deleted after use) that queries `users` by `APP_EMAIL` and calls `createCaptureToken()` directly against the local DB, then deleted it. That works for me sitting at the repo with DB access, but it's not something a future session — especially against a deployed instance, where there's no local DB connection to reach for — could do on its own. Section A.5 of the A1 spec assumes the agent simply "has" a token; today there's no path to that.

## 2. What would the improvement look like?

Some in-app way to obtain a capture token without touching the database directly:

- An authenticated route (e.g. `GET /api/capture-token`), gated by the existing session cookie, that returns a fresh token for the logged-in user — an agent (or the user, once) fetches it while authenticated and hands it to whatever's doing the capture.
- Or a "Capture token" field on a settings/profile page — shown once, copyable, regeneratable if it needs rotating.

Either way it reuses `createCaptureToken()` as-is (already 30-day expiry); this is just about exposing it. Whatever the answer, treat the token as live auth material the same way A.3 already treats the Playwright `storageState` — not something to print into a commit, a log, or a shared doc.

## 3. Resources or references

- `lib/auth.ts:80` — `createCaptureToken()`, currently unreferenced anywhere else in the app.
- `Process/Development/A1. Capture and Store Job Leads.md`, section A.5 ("Submit") — assumes token acquisition is a solved step.
- `app/api/ingest/route.ts` — the consuming endpoint; unconditionally requires `body.token`.

## 4. Notes / Progress log

Workaround used for the 2026-07-23 end-to-end test: minted a token via a temp script reading `APP_EMAIL` from `.env.local`, used it for one `/api/ingest` call, deleted the script. That token expires ~30 days from mint (~2026-08-22) and was not persisted anywhere — re-mint (same throwaway-script method, or whatever ships from this CI) needed for further manual testing before then.
