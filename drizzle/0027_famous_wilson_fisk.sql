ALTER TABLE "education" ADD COLUMN "city_country" text;--> statement-breakpoint
ALTER TABLE "education" ADD COLUMN "date_begin" text;--> statement-breakpoint
ALTER TABLE "education" ADD COLUMN "date_completed" text;--> statement-breakpoint
ALTER TABLE "education" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "education" ADD COLUMN "jd_group_relevance" jsonb DEFAULT '[]'::jsonb;