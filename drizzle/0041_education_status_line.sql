-- C7 · Compile Complete CV Document — CI · C7 Space Rules Are Specified and
-- Never Enforced §2.4a
--
-- `education.status` is the short parenthetical that PRINTS under a
-- qualification on the CV: "(coursework complete, thesis not submitted)".
--
-- It had no column, and the renderer had been reading it out of `notes` by a
-- formatting convention — a LEADING PARENTHESISED LINE meant "print me", and
-- everything after it stayed internal. That worked only because exactly one row
-- happened to be written that way, and it silently makes any future note that
-- opens with a bracket into CV-facing text.
--
-- Nowhere that already existed would do. `qualification` is the entry's head and
-- adding to it pushes the date onto a second line — the owner has just shortened
-- two titles by hand for precisely that reason. `summary` is Keep-gated per job,
-- and a thesis that was never submitted is true of the qualification whichever
-- role the CV answers.
--
-- The backfill is the convention, read once and then retired: it lifts the
-- leading parenthesised line out of `notes` into the new column and takes that
-- line (with its trailing full stop and newline) back out of `notes`, which
-- keeps the remaining prose internal exactly as it was.
--
-- The parenthesis is CAPTURED rather than the line being trimmed, because these
-- notes carry Windows line endings and a trailing CR would otherwise ride into
-- the column and print as a stray character.

ALTER TABLE "education" ADD COLUMN "status" text;--> statement-breakpoint

UPDATE "education"
   SET "status" = (regexp_match("notes", '^\s*(\([^)]*\))'))[1],
       "notes"  = NULLIF(btrim(regexp_replace("notes", '^[^\n]*(\n|$)', '')), '')
 WHERE "notes" ~ '^\s*\([^)]*\)\.?\s*(\r?\n|$)';
