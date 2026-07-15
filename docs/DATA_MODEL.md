# Data Model

The system's data is **already cleanly relational** — it lives in two Excel workbooks that map
to Postgres almost 1:1. This document defines the schema; it is implemented with **Drizzle**
migrations in [`drizzle/`](../drizzle/).

## Sources (gitignored — become seed data)

| Workbook | Role | Becomes |
| --- | --- | --- |
| `Profile/Profile_Reference_Workbook.xlsx` | The **evidence store** ("Master Bullet Bank"): 10–12 ID-linked tables | `positions`, `stars`, `star_*`, `responsibilities`, `education`, `languages`, `bullet_bank`, `skills_master` |
| `Job Hunting Lists.xlsx` | The **operational tracker**: 6 sheets | `companies`, `offices`, `jd_groups`, `job_leads`, `job_requirements`, `requirement_tailoring` |

> Note for the import script: in `Job Hunting Lists.xlsx` the **Job Leads** header is on **row 2**
> (row 1 is a banner); other sheets have headers on row 1. The Profile workbook tables also start
> below a title row. See [`DEPLOYMENT.md`](DEPLOYMENT.md#seeding).

## Conventions

- Every table carries **`owner_id uuid`**; isolation is enforced **in the app layer**
  (`currentOwnerId()`, fail-closed), **not** via RLS (Supabase Auth is not used). One demo user.
- Every table has `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`.
- **Preserve the human reference codes** (`5-3`, `A-R3`, `EDU-3`, `LANG-3`) as a `ref_code text`
  column — downstream steps (C2) quote them verbatim. They are natural keys for idempotent seeding.

## Evidence side (the profile / Master Bullet Bank)

| Table | Key columns | Notes |
| --- | --- | --- |
| `profiles` | name, contact, headline, languages summary | 1 row for the demo (the person) |
| `positions` | `ref_code`, company, title, start/end | FK anchor for evidence |
| `stars` | `ref_code`, position_id→, title, summary, obsidian_note_ref | 7 STAR stories |
| `star_actions` | `ref_code` (e.g. `5-3`), star_id→, text, skills[], ats_keywords[] | ~37 — primary bullet source |
| `star_results` | `ref_code`, star_id→, text, metric, impact_type | ~22 quantified outcomes |
| `star_competences` | `ref_code`, star_id→, competence | ~15 behavioural |
| `star_attributes` | `ref_code`, star_id→, attribute | ~16 personal |
| `responsibilities` | `ref_code` (e.g. `A-R3`), position_id→, text, skills[] | ~22 role-level |
| `education` | `ref_code` (e.g. `EDU-3`), institution, qualification, type | 5 formal/exec |
| `languages` | `ref_code`, language, cefr_level | 4 |
| `bullet_bank` | `ref_code`, text, tags[], `version` | ~23 strongest bullets; used by B6 scoring |
| `skills_master` | `ref_code`, skill, proficiency, `ats_keyword_variants text[]`, star_evidence[] | ~25 skills |

## Pipeline side (the operational tracker)

| Table | Key columns | Notes |
| --- | --- | --- |
| `companies` | name, website, industry, hq_country, interest_score, notes | ~134 target companies |
| `offices` | city, country, preference_rank | ~19 location prefs |
| `jd_groups` | code, name | 6 fixed rows: SCD, CSEO, OSS, CFPA, TPM, POESG |
| `job_leads` | external_id, title, company_id→, office_id→, source_url, posted_days, applicant_count, **status**, roadblocks jsonb, misalignments jsonb, jd_group_primary, jd_group_secondary, `skill_ratings jsonb` (17 A–Q), ats_system, **b6 dimension scores + overall + recommendation**, bullet_bank_version | ~140 leads — the hub |
| `job_requirements` | job_lead_id→, requirement_order, **rank**, requirement_group, requirement, description, skills[], **initial_match_strength**, initial_key_strengths, initial_missing_weak, **initial_score** | ~209 rows |
| `requirement_tailoring` | requirement_id→, evidence_ref (the `ref_code`), original_text, **cv_position**, cv_bullet, cv_placement, actual_skills[], **approval_status** | ~27 rows — the C2 bridge / human-in-the-loop |
| `cv_variants` | name, focus_jd_groups[], storage_path | 6 archetypes (SCD-TPM, CFPA-OSS, POESG, CSEO, TPM-SCD, ATS_Safe) |
| `applications` | job_lead_id→, cv_variant_id→, applied_at, status, outcome_notes | post-application (phase D) |

## System tables

| Table | Purpose |
| --- | --- |
| `pipeline_runs` | Resumable state machine: `job_lead_id`, `step`, `status`, `input_hash`, `output_jsonb`. Drives progress UI and idempotency. |
| `llm_calls` | Cost & audit: `step`, `model`, `input_tokens`, `output_tokens`, `lead_id`, `created_at`. |
| `ci_initiatives` | The ~10 Continuous-Improvement items + "Accuracy Improvement Tips" (replaces the Obsidian dashboard). Fields mirror the CI template: title, area, status, priority, estimated/spent time. |

## Enums

- **`lead_status`**: `captured` · `screening` · `hold` · `screened` · `promoted` · `tailoring` · `ready` · `applied` · `archived`
- **`requirement_rank`**: `Core` · `Important` · `Nice-to-Have`  (scoring weights 3 / 2 / 1)
- **`match_strength`**: `Excellent` (9–10) · `Very Strong` (7–8) · `Good` (5–6) · `Weak` (2–4) · `No Match` (0–1)
- **`approval_status`**: `pending` · `green` (keep) · `yellow` (reassign) · `red` (drop) — *only `green` flows to C3*
- **`recommendation`**: `Proceed` · `Caution` · `Low priority` · `Not recommended`
- **`cv_position`**: standardized CV-section targets that bind tailoring rows to docx placeholders
  (e.g. `Professional Experience - A1. <Project>`, `Professional Experience - B0. Responsibilities`,
  `Profile`, `Skills`, `Education`, `Language`). Defines the `docxtemplater` tag set.
- **`jd_group`**: `SCD` · `CSEO` · `OSS` · `CFPA` · `TPM` · `POESG`

## Relationships (overview)

```
profiles 1─┬─< positions 1─< stars 1─< star_actions / star_results / star_competences / star_attributes
           ├─< responsibilities   ├─< education   ├─< languages   ├─< bullet_bank   └─< skills_master
           │
           └─< job_leads >─ companies, offices, jd_groups (primary/secondary)
                  │
                  1─< job_requirements 1─< requirement_tailoring >─ (evidence_ref → star_actions/responsibilities/…)
                  │                                                     │ approval_status gates → C3 bullets
                  1─< applications >─ cv_variants
```

The **`requirement_tailoring` table is the heart of the system**: it links what a JD *asks for*
(`job_requirements`) to what the profile can *prove* (`evidence_ref`), carries the drafted
`cv_bullet`, and holds the human `approval_status` that decides whether that evidence reaches the CV.
