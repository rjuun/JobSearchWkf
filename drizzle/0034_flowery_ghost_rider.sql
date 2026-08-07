ALTER TABLE "education" ADD COLUMN "summary" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "languages" ADD COLUMN "display_level" text;