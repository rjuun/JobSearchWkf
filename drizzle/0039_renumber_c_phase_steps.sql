-- C-phase renumber · historical `pipeline_runs.step` / `llm_calls.step` migration
-- CI · Renumber the C-Phase to Seat Evidence Selection at C3 §2.4
--
-- A new step, "Select the CV Evidence Set", takes C3. The step CODES above it
-- moved; the step bodies did not:
--
--   old C3  Transform Evidence into CV Bullets  -> C4
--   old C4  Build and Manage the Skills Section -> C5
--   old C5  Drafting CV Profile                 -> C6
--   old C6  Compile Complete CV Document        -> C7
--   old C7  Run Reviewed ATS Matching Rating    -> C8
--
-- Rows already stored carry the OLD codes. Left alone, a lead tailored before this
-- change would render a `C3` trace meaning "bullets" beside a `C3` trace meaning
-- "evidence selection" — one code silently naming two different steps, and a run
-- history that lies about what was executed. Same reasoning as the B-phase reorder
-- (0028_reorder_b_phase_steps.sql), and the same remedy.
--
-- ── Why the type is recreated rather than extended ─────────────────────────
-- `C8` does not exist in `pipeline_step` yet, and drizzle's migrator runs every
-- pending migration inside ONE transaction (pg-core/dialect.js → session.transaction).
-- Postgres forbids USING a value added by `ALTER TYPE ... ADD VALUE` in the same
-- transaction that added it ("unsafe use of new value of enum type"), so the
-- generated one-liner plus an UPDATE writing 'C8' would abort — and splitting them
-- across two files would not help, since both still share that transaction.
--
-- Recreating the type has no such restriction: a type CREATEd in the current
-- transaction may be used in it freely. `pipeline_runs.step` is the only column of
-- this type (lib/db/schema.ts §564), which is what makes the swap tractable.
--
-- ── Why one CASE and not five UPDATEs ──────────────────────────────────────
-- C3→C4→C5→C6→C7→C8 is a chain. Sequential UPDATEs would collide: rename C3->C4
-- first and the pre-existing C4 rows become indistinguishable from the ones just
-- moved. The CASE below reads the old value and writes the new one in a single
-- pass, so nothing is ever observable mid-shift.
--
-- ── Once-only ──────────────────────────────────────────────────────────────
-- This shift is NOT idempotent: applying it twice would move every code up again
-- and quietly corrupt the history. Drizzle's `_journal.json` is what guarantees
-- once-only execution — this file is journaled as idx 39 and the migrator records
-- it in `drizzle.__drizzle_migrations`. Do not run it by hand against a database
-- that has already had it applied.

ALTER TYPE "public"."pipeline_step" RENAME TO "pipeline_step_old";--> statement-breakpoint
CREATE TYPE "public"."pipeline_step" AS ENUM('A1', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8');--> statement-breakpoint

-- The CASE leaves A1, B1–B6, C1 and C2 as they are: those codes did not move.
ALTER TABLE "pipeline_runs"
  ALTER COLUMN "step" TYPE "public"."pipeline_step"
  USING (
    CASE "step"::text
      WHEN 'C7' THEN 'C8'  -- Run Reviewed ATS Matching Rating
      WHEN 'C6' THEN 'C7'  -- Compile Complete CV Document
      WHEN 'C5' THEN 'C6'  -- Drafting CV Profile (Per Job Lead)
      WHEN 'C4' THEN 'C5'  -- Build and Manage the Skills Section
      WHEN 'C3' THEN 'C4'  -- Transform Evidence into CV Bullets
      ELSE "step"::text
    END
  )::"public"."pipeline_step";--> statement-breakpoint

DROP TYPE "public"."pipeline_step_old";--> statement-breakpoint

-- `llm_calls.step` is plain `text`, not the enum, so it moves on its own. The
-- `WHERE` keeps the backtest labels `C2-bt-base` / `C2-bt-cand`
-- (scripts/backtest-notes.ts) and every non-C code untouched.
UPDATE "llm_calls"
SET "step" = CASE "step"
      WHEN 'C7' THEN 'C8'
      WHEN 'C6' THEN 'C7'
      WHEN 'C5' THEN 'C6'
      WHEN 'C4' THEN 'C5'
      WHEN 'C3' THEN 'C4'
    END
WHERE "step" IN ('C3', 'C4', 'C5', 'C6', 'C7');
