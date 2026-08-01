CREATE TABLE "requirement_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_lead_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"evidence_ref" text NOT NULL,
	"evidence_kind" text,
	"evidence_text" text,
	"cv_position" text,
	"note" text
);
