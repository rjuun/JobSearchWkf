# P3 — Tailoring: C1–C7 + CV Generation

**Status:** ✅ Complete · **Goal:** turn a promoted lead into a tailored, downloadable 2-page CV,
with a human approving exactly what evidence makes the cut.

> **Acceptance (met):** promote a lead → map evidence → mark a few rows Keep → generate → a
> valid 8.7 KB `.docx` is produced with an ATS rating. Verified by `scripts/verify-tailoring.ts`.

---

## The human-in-the-loop, made real

Tailoring is split into two halves around a **human gate**:

```
runEvidenceMapping   C1 format/headshot  →  C2 map requirement→evidence (status: pending)
        │
        ▼   ── the human marks each row  Keep (green) / Maybe (yellow) / Drop (red) ──
        │
generateCv           C3 bullets (KEEP ONLY) → C4 skills → C5 profile → C6 .docx → C7 ATS rating
```

Only **Keep** evidence flows into C3. This is the system's most differentiated behavior — the
agent proposes, the human decides, and the CV contains only kept, evidenced claims.

## What was built

| Component | File | Notes |
| --- | --- | --- |
| **Tailoring orchestrator** | `lib/pipeline/tailoring.ts` | `runEvidenceMapping` (C1–C2) and `generateCv` (C3–C7); shared run-recorder via `lib/pipeline/runs.ts`. |
| **Evidence matching (C2)** | (same) | The LLM maps each Core/Important requirement to its strongest evidence across the **whole graph** (STAR actions, responsibilities, bullets, education, languages) with a match-strength + honest gaps → a `requirement_tailoring` row, `pending`. (Token overlap survives only as the C4 skills-ranking heuristic and the offline mock.) |
| **CV generator (C6)** | `lib/docx/template.ts` (+ `lib/docx/cv.ts` fallback) | Fills the real 2-page Word template (`Group CVs/CV_Template.docx`) via `docxtemplater` when the Keep set maps to its slots; otherwise builds the layout programmatically with the `docx` library. |
| **Gate UI** | `components/roleproof/workspace.tsx` | Per-row **Keep / Maybe / Drop**; "Generate CV" enables only when ≥1 row is kept; live trace + ATS rating + download. |
| **Download** | `app/api/cv/[leadId]/route.ts` | Authenticated `.docx` download. |
| **Actions** | `app/actions/tailoring.ts` | `mapEvidenceAction`, `setApprovalAction`, `generateCvAction`. |

## How it runs

On a **promoted** lead: **Map evidence (C1–C2)** → review the rows, click **Keep/Drop** → **Generate
CV** → see the ATS rating and **Download CV**. Headless: `npx tsx scripts/verify-tailoring.ts`.

## Verification evidence

```
C1 Format & compliance        Headshot: Optional (lean exclude)
C2 Map requirements→evidence  6 evidence links · pending review
   kept: 4
C3 Draft CV bullets           4 bullets from Keep evidence
C4 Skills section             12 skills · 2 groups
C5 Tailored profile           300 chars
C6 Compile 2-page CV          4 bullets · .docx ready
C7 ATS matching rating        73 / 100
CV: 8727 bytes · valid .docx: true   ✓
```

## Decisions & known gaps (carried to the retrospective)

- **Programmatic `docx`, not docxtemplater-on-template.** The blueprint's production path fills the
  owner's existing `.docx` template; the prototype generates programmatically (reliable, no binary
  template to re-tag). **Gap:** swap to docxtemplater on the owner's template to preserve exact
  formatting (a P5/post-prototype refinement).
- **C7 is a coverage metric, not an Opus judgment.** Deterministic `40 + coverage·55 (+5 if ATS)`.
  **Gap:** the production C7 should be an Opus ATS-match scoring call.
- **Skills grouped by proficiency, not category.** `skill_category` wasn't carried into the schema.
  **Gap:** add `skill_category` and group by it (C4's intended 3–5 categories).
- **Single "Selected Achievements" heading** rather than per-position grouping. **Gap:** group
  bullets by `cv_position`/role.

## Simplify pass (applied)

- Extracted `recordStep` (record-a-run + return-a-report) into `lib/pipeline/runs.ts`, collapsing
  the repeated pattern across all seven C-steps.
- Shared `CORE_AND_IMPORTANT` constant (was duplicated in C2 and C7 filters).
- (Earlier in the phase) moved `StepReport` + `recordRun` to `lib/pipeline/runs.ts` so screening
  and tailoring share them.

## Next — P4

CI dashboard + polish: pipeline analytics, the ~10 CI initiatives, an Accuracy-Improvement-Tips
surface, the `llm_calls` cost panel, and demo-grade empty/loading/error states.
