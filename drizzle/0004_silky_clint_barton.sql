CREATE TABLE IF NOT EXISTS "coaching_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"raw_answer" text,
	"draft_action" text,
	"draft_result" text,
	"metric" text,
	"needs_metric" boolean DEFAULT false NOT NULL,
	"confidence" real,
	"committed_node_id" uuid,
	"decision" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coaching_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tier" text DEFAULT 'position_deep' NOT NULL,
	"prompt_source" text DEFAULT 'seed' NOT NULL,
	"source_ref" jsonb,
	"context_label" text,
	"question" text NOT NULL,
	"why" text,
	"payoff" text,
	"status" text DEFAULT 'open' NOT NULL,
	"spawned_by" uuid,
	"target_node" jsonb,
	"dedupe_key" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "graph_strength_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"score" integer NOT NULL,
	"label" text,
	"components" jsonb
);
