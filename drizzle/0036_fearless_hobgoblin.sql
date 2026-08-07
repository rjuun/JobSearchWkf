CREATE TABLE "bullet_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"confidence" real,
	"bullet_id" uuid NOT NULL,
	"evidence_table" text,
	"evidence_key" text
);
