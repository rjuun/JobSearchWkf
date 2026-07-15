CREATE TABLE IF NOT EXISTS "story_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"through_line" text NOT NULL,
	"cover_letter" text,
	"linkedin_about" text,
	"evidence_count" integer
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "public_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "public_token" text;