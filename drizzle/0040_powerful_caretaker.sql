-- C3 · Select the CV Evidence Set — CI · C3 Selects the CV Evidence Set §2.7 item 1
--
-- `shortlist_rank` is C3's verdict on each Keep row: 1..B in the order the
-- selected evidence stands, NULL for evidence that was not selected. Nullable
-- and with no default on purpose — NULL is the honest state for every row that
-- exists today, because no run has selected anything yet, and a default of 0
-- would have to mean either "rank zero" or "not selected" and could not mean
-- both.
--
-- `shortlist_pin` is the owner's override on that verdict: 'pin' forces the
-- row's evidence into the set before the algorithm runs, 'exclude' keeps it
-- out. NULL means "let C3 decide", which is every row until someone says
-- otherwise. Left as plain text rather than an enum: more values are plausible
-- here later, and 0039 above is a standing demonstration of what it costs to
-- change a pg enum inside drizzle's single-transaction migrator.
--
-- Both are rewritten from scratch on every Generate CV, like `cv_bullet`, so
-- there is nothing to backfill: the next run of a lead computes its own.

ALTER TABLE "requirement_tailoring" ADD COLUMN "shortlist_rank" integer;--> statement-breakpoint
ALTER TABLE "requirement_tailoring" ADD COLUMN "shortlist_pin" text;
