---
ci-area: Infrastructure
ci-title: RoleProof as Stand-alone App (Migration to Supabase + NAS Postgres Setup)
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-07-24
ci-estimated-time:
ci-time-spent:
pr-source:
pr-target:
---
---
```simple-time-tracker
{"entries":[]}
```
---
## 1. What is the problem or opportunity?

Discovered mid-session (2026-07-23/24), as a spin-off from the Job Lead Capture work: RoleProof is already deployed and live on Vercel (`role-proof.vercel.app`), confirmed by fetching it directly — `ARCHITECTURE.md`'s claim was true this time, unlike its earlier claim about capture-time
company/office enrichment, which turned out to be aspirational. Production apparently already runs on Supabase per `DEPLOYMENT.md`'s stack description. Local development, meanwhile, runs against a self-hosted Postgres on Reggie's Synology NAS (`192.168.188.2:5433`) — a **separate database from production**, kept in sync only by manually re-running migrations/seed scripts pointed at Supabase (per `DEPLOYMENT.md` §3). That's real, ongoing drift risk the longer development continues.

While investigating that, the NAS Postgres port was port-forwarded and DDNS-exposed
(`kubos.myds.me:5433`) to test whether it could serve as an internet-reachable backup destination
for Supabase (whose free tier has **no built-in backups or PITR at all**, confirmed live). The
password was rotated from a weak default (`postgres123`) to a strong random one before testing
further. Reggie then tested the app against that internet-facing address from his phone's Wi-Fi and
reported no noticeable slowdown — validating (with one caveat below) that this setup also works
from outside the home network, e.g. cafes/libraries.

That last finding reopens a bigger question than originally scoped: given the NAS Postgres is now
confirmed reachable, reasonably fast, and fully owned (no third-party free-tier limits), is
migrating local dev *into* Supabase still the right target — or is running the NAS as the primary
database (for local dev, and possibly beyond) actually the more resilient long-term shape, with
Supabase relegated to something else (e.g. just the deployed prod copy, or dropped entirely)?

## 2. What would the improvement look like?

Decide the actual end-state architecture, then execute it. Real options on the table, not yet
chosen between:

- **A — Migrate local dev into the same Supabase project as production.** Removes the two-database
  drift problem entirely. Use the app's existing owner-scoped multi-user support (sign up a
  separate test account) to keep experimental/test data away from real data in the same project,
  rather than standing up a second Supabase project. Effort estimated at a previous session: ~half
  a day, mostly `pg_dump`/`pg_restore` of the ~156 real leads currently only in the NAS Postgres.
- **B — Keep the NAS Postgres as the primary database going forward** (local dev, and possibly
  eventually production too), now that it's validated as externally reachable and performant, and
  use Supabase only as a secondary/backup copy, or drop it.
- **C — Hybrid:** Supabase stays the production database (as it apparently already is); the NAS's
  role is formalized specifically as an independent backup destination — a scheduled job dumping
  Supabase periodically to somewhere on the NAS — regardless of which of A/B is chosen for local dev.

Whichever direction: harden the current exposure. The router port-forward is currently open to any
source IP; consider restricting it if the NAS ends up in permanent use rather than as a temporary
test, and keep the rotated password out of anywhere it could leak (it's currently sitting in plain
text in `.env.local`, gitignored — fine locally, worth a reminder not to let it leak elsewhere).

## 3. Resources or references

- `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` — the documented (and now partially verified-live)
  Vercel + Supabase stack.
- Synology DDNS: `kubos.myds.me` → `212.17.72.91`, port 5433 forwarded to the NAS's Postgres
  container (`Docker roleproof-db`).
- Supabase free tier: confirmed via web search (2026-07-24) to have **no automatic backups and no
  PITR at any price below Pro's paid add-on** — the concrete reason a self-owned backup path matters
  here regardless of which option (A/B/C) is chosen.

## 4. Notes / Progress log

- 2026-07-24: Password rotated (`ALTER USER postgres WITH PASSWORD …`) before any further exposure
  testing. `.env.local` temporarily pointed at the DDNS host to test latency; confirmed no noticeable
  slowdown from phone Wi-Fi.
- **Caveat on that test:** a same-network "internet address" test can be misleading if the router
  does NAT loopback/hairpinning (routing traffic to its own public hostname back over the LAN
  invisibly) — worth a true cellular-data-only test at some point for full confidence, even though
  the phone-Wi-Fi result is being treated as sufficient validation for now.
- Not yet decided: A vs. B vs. C above. This CI item exists to hold the question, not resolve it —
  revisit once there's a moment to actually weigh them rather than mid-diversion.
