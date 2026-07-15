# Demo Runbook — the 5-minute click-path

*Milestone M0. The shipped demo must tell the same story as the pitch. This is the exact
path to walk in a meeting, and the setup that makes the tenant coherent.*

## Persona

One coherent identity across the whole tenant:

- **Reginaldo (Reggie) Silva Junior** — Senior Finance & Transformation Leader, Vienna.
- Contact `reginaldo.silvajr@gmail.com` (the persona's own address — **not** the `APP_EMAIL`
  sign-in credential, which stays off-screen). Name ↔ email ↔ history now agree.

## Setup (once)

```bash
npm run db:migrate          # schema up to date
npx tsx scripts/seed-users.ts  # the login user (uses APP_EMAIL / APP_PASSWORD from .env.local)
npm run seed                # the demo tenant — idempotent; reproduces the shaping below exactly
npm run dev                 # http://localhost:3000  → sign in with APP_EMAIL / APP_PASSWORD
```

The seed **shapes the tenant for the demo** (see `scripts/seed.ts` → `shapeDemoTenant`):

- **Deliberate, believable gaps** so the meter isn't dead and the coach has real things to ask:
  2 stories with no quantified result, 6 skills with no ATS variants, 1 role with no one-line scope.
- **A golden-path "ready" CV** on *Change Manager @ RHI Magnesita* — 12 lines, each traced to
  human-approved evidence (the provenance ledger), with the `.docx` pre-compiled so Download works.
- **A funnel across all four stages**: Capture → Screen → Tailor (the ready CV) → Apply (2 sent).

No dev chrome: the MOCK/LIVE header pill is **off by default** (`SHOW_LLM_PILL=1` to bring it back
in development). The **Machinery** toggle (⚙) is a feature, not chrome — leave it off for the story,
flip it on only if someone asks "how does it actually work" (it reveals step codes / the B6 formula /
evidence ref_codes).

## The click-path (≈5 min)

1. **Career Graph** (`/profile`) — the home surface. The strength meter is mid-band with visible
   headroom, not a dead 100. Point at the named signals and the "to strengthen" hints.
2. **Open the Coach** (`/profile/coach`). Three *specific, non-repetitive* prompts are waiting —
   e.g. "What was the measurable impact of *Transforming Governance Process*?" (a real story missing
   a number), a target-role requirement several tracked roles ask for, and a screening watch-out
   turned into a question. Answer one: draft → approve → it lands as evidence and the meter moves.
3. **Leads** (`/roleproof`) — the board. A real pipeline: leads captured, a batch screened, one CV
   ready, two applications out.
4. **Open a screened lead with a watch-out** — show the Role Fit verdict (Proceed / Borderline /
   Hold), the honest misalignment flag, and the "add the evidence with your coach" bridge (it routes
   to a matching coach question, never a dead end).
5. **Open *Change Manager @ RHI Magnesita*** (the ready CV). This is the payoff: "12 lines, each
   traced to evidence you approved · 0 unverifiable claims." Expand **Provenance** — every line shows
   its graph `ref_code` → the requirement it answers. Download the `.docx`.

## Known interim state (honest)

- **Strength reads ~89 / "Strong", not ~60 / "Solid" yet.** The current `strengthOf` has a hard floor
  (~60) that a rich profile saturates, so believable gaps can't pull it into mid-band. **M1** reworks
  it to the component model (Foundation / Quantified impact / ATS coverage / **Relevancy vs. flagged
  targets** / **Freshness**) — the last two sit empty for a fresh seed, creating the headroom that
  lands the same seed at ~60. Until M1 ships, the meter looks fuller than the pitch implies; every
  other M0 acceptance item holds.
- The coach queue is **tier-first** (ATS-type prompts group first). Cross-engine value ranking is
  **M2** — for now all four engines fire, so the page shows variety even if the top group is ATS.
