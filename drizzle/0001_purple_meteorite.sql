CREATE TABLE IF NOT EXISTS "onboarding_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"step" text DEFAULT 'welcome' NOT NULL,
	"source" text,
	"raw_text" text,
	"draft_graph" jsonb,
	"status" text
);
