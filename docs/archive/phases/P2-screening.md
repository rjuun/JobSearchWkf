# P2 — Screening: Capture + B1–B6 + Role Fit Score

**Status:** ✅ Complete · **Goal:** run the full B-stage screening on a lead, live, and produce a
reproducible Role Fit Score.

> **Acceptance (met):** screening a real JD runs B1→B6 and yields a Role Fit Score whose value
> **exactly equals the deterministic rollup** of its five dimensions — verified by
> `scripts/verify-screening.ts` (`6.9` persisted = `6.9` recomputed).

---

## The core principle, in code

The LLM emits **judgments**; **`lib/scoring.ts` does all the arithmetic**. B6 never returns an
"overall" — the model rates Relevance, Seniority, Impact, ATS (0–10) and each requirement; the
code computes:

```
overall = 0.35·relevance + 0.20·seniority + 0.20·impact + 0.15·reqAlignment + 0.10·ats
reqAlignment = Σ(reqScore·weight) / Σ(weight),   weight = Core 3 / Important 2 / Nice 1
recommendation: ≥7 Proceed · ≥5.5 Caution · ≥4 Low priority · else Not recommended
```

This makes the score **reproducible** — same inputs + same bullet-bank version → same number.

## What was built

| Component | File | Notes |
| --- | --- | --- |
| **Anthropic client** | `lib/anthropic/client.ts` | Single choke point: forces one tool call, validates with zod (+ 1 retry), logs tokens. **Mock mode** returns deterministic fixtures so the pipeline runs with no API key; **live mode** calls Claude (Sonnet for B2–B5, Opus for B6). |
| **Step contracts** | `lib/anthropic/schemas.ts` | zod + JSON Schema per step (B2–B6). B6 per-requirement judgments carry a stable `order` for robust match-back. |
| **Scoring** | `lib/scoring.ts` | Deterministic rollup, requirement alignment, recommendation tiers, B1 freshness/saturation bands + the ≥60-day hold gate. |
| **Prompts** | `lib/prompts.ts` | Loads the owner's `Process/*.md` notes as system prompts (cached) + a shared non-negotiables preamble. |
| **Orchestrator** | `lib/pipeline/screening.ts` | `runScreening(leadId)` runs B1 (code) → B2–B6 (LLM), persists to `job_leads`/`job_requirements`, records `pipeline_runs` + `llm_calls`, returns a per-step report. |
| **Capture** | `lib/pipeline/capture.ts`, `app/api/ingest/route.ts`, `app/roleproof/capture` | Signed-token bookmarklet endpoint + manual paste form → creates a lead + stores the JD. |
| **Console UI** | `components/pipeline-console.tsx` | "Run screening" → live per-step status + the B6 result, plus the **Promote to tailoring** gate (shown only when the recommendation clears the bar). |

## Mock vs live

`LLM_MODE=mock` (default) makes every step return a deterministic fixture derived from the JD
text + seeded data — so the whole pipeline demos offline and `verify-screening.ts` is reproducible.
Set `LLM_MODE=live` + `ANTHROPIC_API_KEY` to call the real models; the contract (forced tool-use →
zod → persist) is identical, so nothing else changes.

## How it runs

- In the app: open a lead → **Run screening** → watch B1→B6 → see the score + recommendation; if it
  clears the bar, **Promote to tailoring**.
- Headless check: `npx tsx scripts/verify-screening.ts` screens a lead and asserts the rollup.

## Verification evidence

```
B1  Freshness & saturation   Fresh · High               [code]
B2  Roadblocks               None                       [sonnet (mock)]
B3  Misalignments            2 flagged                  [sonnet (mock)]
B4  Skills · JD group · ATS  17 rated · CSEO · Workday  [sonnet (mock)]
B5  Extract requirements     12 extracted               [sonnet (mock)]
B6  Role fit score           6.9 / 10 · Caution         [opus (mock)]
dimensions {relevance 6.6, seniority 8, impact 7, reqAlignment 6, ats 7}
persisted overall 6.9 = recomputed 6.9   ✓
```

## Simplify pass (applied)

- Deduped `round1` + `matchStrengthToScore` into `lib/scoring.ts` (were duplicated in the pipeline).
- Cached the `Process/*.md` note reads (was re-reading from disk on every step).
- B5 uses `.returning()` instead of an insert-then-reselect round-trip.
- **B6 match-back now keys on a stable `order`** (with text + index fallbacks) rather than array
  index — robust if the live LLM reorders or omits a requirement.

## Next — P3

Tailoring: C1–C7, the C2 Keep/Maybe/Drop human gate, and CV `.docx` generation from
Keep evidence.
