ALTER TABLE "positions" ADD COLUMN "city_country" text;--> statement-breakpoint
-- Superseded by languages.display_level (migration 0034). Drizzle's own tracking
-- already believes this was dropped in 0034 (it was in that migration's
-- auto-generated SQL before being deliberately trimmed out, per that CI's own
-- note) — it will not regenerate this statement again, so it's added by hand
-- here rather than lost.
ALTER TABLE "profiles" DROP COLUMN "languages_summary";