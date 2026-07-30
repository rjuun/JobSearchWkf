-- B-phase reorder · historical `pipeline_runs.step` migration
-- CI · Lead Page as Pipeline Canvas §2.1, §3.1
--
-- The step CODES moved; the step bodies did not:
--
--   old B5  Extract Requirements   -> B2
--   old B2  Identify Roadblocks    -> B3
--   old B3  Identify Misalignments -> B4
--   old B4  Areas of Expertise     -> B5
--
-- Rows already in `pipeline_runs` carry the OLD codes. Left alone, a lead screened
-- before this change would render a `B2` trace meaning "roadblocks" directly beside
-- a `B2` trace meaning "requirements" — one code silently naming two different
-- steps, and a run history that lies about what was executed. §3 offered two ways
-- out: migrate the rows, or key the step registry on note identity rather than the
-- `B<n>` string. Migrating is the cleaner of the two, and it is what this does.
--
-- ── Why one statement and not four ─────────────────────────────────────────
-- B2->B3->B4->B5 is a chain, and B5->B2 closes it into a cycle, so sequential
-- UPDATEs would collide: rename B2->B3 first and the pre-existing B3 rows become
-- indistinguishable from the ones just moved. `pipeline_step` is a pgEnum, so
-- parking values in a scratch string would mean widening the type. Instead every
-- affected row moves in ONE statement whose CASE reads the old value and writes the
-- new one — nothing is ever observable mid-cycle.
--
-- ── Once-only ──────────────────────────────────────────────────────────────
-- This rotation is NOT idempotent: applying it twice would rotate the codes again
-- (requirements B2 -> B3, and so on) and quietly corrupt the history. Drizzle's
-- `_journal.json` is what guarantees once-only execution — this file is journaled as
-- idx 28 and the migrator records it in `drizzle.__drizzle_migrations`. Do not run
-- it by hand against a database that has already had it applied.

-- `WHERE step IN (...)` keeps B1, B6, A1 and every C step untouched: those codes did
-- not move, and rewriting them would churn rows to no effect.
UPDATE "pipeline_runs"
SET "step" = CASE "step"
      WHEN 'B5' THEN 'B2'  -- Extract Requirements  (now first in the phase)
      WHEN 'B2' THEN 'B3'  -- Identify Roadblocks
      WHEN 'B3' THEN 'B4'  -- Identify Misalignments
      WHEN 'B4' THEN 'B5'  -- Areas of Expertise + JD Groups
    END::"pipeline_step"
WHERE "step" IN ('B2', 'B3', 'B4', 'B5');
