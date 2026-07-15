# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

RoleProof is an **agentic job-search system**: a staged, gated pipeline that screens
job leads and produces ATS-optimised, evidence-backed CVs. The repo currently holds the
**system** (documented methodology + AI operating instructions) and a working Next.js prototype.
The canonical app routes are `/roleproof`, `/roleproof/capture`, and `/roleproof/leads/[id]`.

Two things live here and must not be confused:
1. **The methodology** — human-readable process notes in `Process/` (steps A1, B1–B6, C1–C7,
   CI, D). These are the source of truth for *what the system does* and double as the **prompt
   templates** for the future app. **Reference and refine them; do not rewrite them into code.**
2. **The blueprint** — `docs/` describes the SaaS that executes that methodology (built and live;
   see `docs/README.md` for the map). Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and
   `docs/PIPELINE.md` together to get the big picture; no single file contains it.

`Claude_Project_Instructions.md` and `Process/+ Job Hunting Master Instructions.md` are the
original AI operating contract (the Master Instructions supersedes the Project Instructions and
declares itself the central manual). The rules below are lifted from them — honor them in any
tailoring/scoring work, automated or not.

## Non-negotiables (apply without exception)

These are the system's defining constraints. They are why it produces trustworthy output:

- **Truthfulness over optimisation.** Never fabricate, exaggerate, or imply experience not
  evidenced in the profile. Never claim a skill not in the evidence store. Never soften a gap
  to make a match look stronger. If a requirement has no honest match, say so and flag it.
- **Evidence-bound ATS.** Mirror JD keywords only when genuinely supported by evidence; choose
  phrasing from each skill's ATS keyword variants; adapt formatting to the detected ATS system.
  Never add unsupported keywords.
- **Honest uncertainty.** Quantify gaps (Weak / No Match); state when evidence is only partial;
  ask one clarifying question rather than assuming.
- **Anti-sycophancy.** Change a position only on new evidence or a logical argument — never on
  pressure, repetition, or frustration. When holding a position, name exactly what would change it.
- **Tone.** Direct, precise, concise. No filler. When scoring, always output
  **Score + Match Strength + Key Evidence + Gaps** — never a score without rationale or vice versa.

## Architecture rules that shape the code

- **The LLM judges; code computes.** Pipeline steps call the LLM provider (**DeepSeek**, an
  OpenAI-compatible API) to emit *judgments* (per-dimension 0–10 scores, match-strength enums,
  evidence references, gap notes) via **forced function/tool calls with a JSON schema**. All
  **rollups, weighted averages, and gates are pure TypeScript** (`lib/scoring`), never left to the
  model. This makes the Role Fit Score (B6) reproducible. See `docs/PIPELINE.md` for the B6 formula
  (35/20/20/15/10 weights; requirement alignment weighted Core=3 / Important=2 / Nice=1).
- **Model per step** (two tiers, from the Master Instructions): an **extraction/mapping** tier
  (B1–B5, C2–C5) and a **scoring** tier (B6, C7). Both resolve from env in the single client wrapper
  (`lib/llm/client.ts`) — currently `deepseek-chat` for both (it supports the function calling
  the forced-tool contract needs); `DEEPSEEK_MODEL` / `DEEPSEEK_MODEL_REASON` override. Resolve model
  IDs from env, not hardcoded constants.
- **Process notes are prompts.** Load the relevant `Process/*.md` note as the step's system
  prompt, prepend the shared non-negotiables, append the tool schema. Refining a step = editing
  its markdown note, not changing code.
- **Human-in-the-loop is core, not optional.** Step C2 produces requirement→evidence links that
  a human marks **Keep / Maybe / Drop**; **only Keep evidence flows to C3** (bullet drafting).
  The database enum remains `green/yellow/red` for now, but user-facing language should use
  Keep/Maybe/Drop everywhere.
- **Preserve the reference convention.** Evidence is cited by human IDs like
  `tbl_STAR_Actions > 5-3`, `tbl_Responsibilities > A-R3`, `tbl_Education > EDU-3`. Keep these as
  a `ref_code` column when migrating to Postgres — downstream steps quote them verbatim.
- **CV generation fills the existing template.** Use `docxtemplater` on the 2-page Word template
  in `Group CVs/CV_Template.docx` (placeholders keyed to a `cv_position` enum). Do not rebuild the
  layout programmatically. Enforce 2 pages by **content budget** (the C6 space rules), not by
  measuring page count. See `docs/ARCHITECTURE.md §docx`.

## Commands

- `npm run dev` — run the Next.js app locally.
- `npm run typecheck` — TypeScript verification.
- `npm run test` — the pure Vitest suite (no DB/network/LLM).
- `npm run build` — production build verification.
- `npm run db:migrate && npm run seed` — migrate and seed local Postgres from gitignored data.
- `npm run db:deploy` — one-shot data load (migrate → seed → demo-login); point env at the target DB.
  See `docs/DEPLOYMENT.md`.

## Privacy / git (critical)

Personal career data is **never committed**. `Profile/`, `Group CVs/`, `Job Descriptions/`, and
all `*.xlsx/*.docx/*.pdf` are gitignored. The repo tracks the *system* (methodology, instructions,
`docs/`). When building, those workbooks become **gitignored seed data** — keep them out of commits
and out of any deployed bundle. Never put the DeepSeek key (or Supabase service-role key) in client
code or `NEXT_PUBLIC_*`; all LLM calls are server-side.

## Where to look

| Need | File(s) |
| --- | --- |
| The end-to-end process, step by step | `docs/PIPELINE.md` → links into `Process/*.md` |
| The data model / future schema | `docs/DATA_MODEL.md` (derives from the two `.xlsx` workbooks) |
| Target architecture & key decisions | `docs/ARCHITECTURE.md` |
| What to build next, in what order | `docs/ROADMAP.md` |
| How to deploy & seed | `docs/DEPLOYMENT.md` |
| The original AI operating contract | `Process/+ Job Hunting Master Instructions.md`, `Claude_Project_Instructions.md` |
| The scoring spec (most logic-heavy) | `Process/B6. Role Fit & Investment Worthiness Score.md` |
