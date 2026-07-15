CREATE TYPE "public"."approval_status" AS ENUM('pending', 'green', 'yellow', 'red');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('captured', 'screening', 'hold', 'screened', 'promoted', 'tailoring', 'ready', 'applied', 'archived');--> statement-breakpoint
CREATE TYPE "public"."pipeline_step" AS ENUM('A1', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'done', 'error');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accuracy_tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_lead_id" uuid,
	"type" text,
	"observation" text,
	"suggested_action" text,
	"where_applies" text,
	"resolved" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_lead_id" uuid NOT NULL,
	"cv_variant_id" uuid,
	"applied_at" timestamp with time zone,
	"status" text,
	"outcome_notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bullet_bank" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"text" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"cv_position" text,
	"version" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ci_initiatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"area" text,
	"status" text,
	"priority" text,
	"estimated_time" text,
	"time_spent" text,
	"source" text,
	"target" text,
	"body" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"industry" text,
	"hq_country" text,
	"interest_score" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cv_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"focus_jd_groups" jsonb DEFAULT '[]'::jsonb,
	"storage_path" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "education" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"institution" text,
	"qualification" text,
	"type" text,
	"year" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jd_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_id" text,
	"seq" integer,
	"title" text NOT NULL,
	"company" text,
	"company_id" uuid,
	"city" text,
	"source_url" text,
	"job_post_link" text,
	"status" "lead_status" DEFAULT 'captured' NOT NULL,
	"posted_days" integer,
	"applicant_count" integer,
	"freshness_band" text,
	"saturation_band" text,
	"analysis_date" text,
	"roadblocks" jsonb DEFAULT '[]'::jsonb,
	"misalignments" jsonb DEFAULT '[]'::jsonb,
	"jd_group_primary" text,
	"jd_group_secondary" text,
	"skill_ratings" jsonb DEFAULT '{}'::jsonb,
	"ats_system" text,
	"ats_specifics" text,
	"key_patterns" text,
	"score_relevance" real,
	"score_seniority" real,
	"score_impact" real,
	"score_req_alignment" real,
	"score_ats" real,
	"overall_fit_score" real,
	"recommendation" text,
	"bullet_bank_version" text,
	"raw_jd_path" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_lead_id" uuid NOT NULL,
	"lead_title" text,
	"requirement_order" integer,
	"rank" text,
	"requirement_group" text,
	"requirement" text NOT NULL,
	"description" text,
	"skills" jsonb DEFAULT '[]'::jsonb,
	"initial_match_strength" text,
	"initial_key_strengths" text,
	"initial_missing_weak" text,
	"initial_score" real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"language" text,
	"cefr_level" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_lead_id" uuid,
	"step" text,
	"model" text NOT NULL,
	"mode" text,
	"input_tokens" integer DEFAULT 0,
	"output_tokens" integer DEFAULT 0,
	"latency_ms" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"city" text,
	"country" text,
	"preference_rank" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_lead_id" uuid NOT NULL,
	"step" "pipeline_step" NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"input_hash" text,
	"output" jsonb,
	"error" text,
	"model" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"company" text,
	"title" text,
	"start_date" text,
	"end_date" text,
	"summary" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"headline" text,
	"email" text,
	"phone" text,
	"location" text,
	"languages_summary" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "requirement_tailoring" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_lead_id" uuid,
	"requirement_id" uuid,
	"lead_title" text,
	"requirement_line" text,
	"connection_to_expertise" text,
	"evidence_ref" text,
	"original_text" text,
	"cv_position" text,
	"cv_bullet" text,
	"cv_placement" text,
	"actual_skills" jsonb DEFAULT '[]'::jsonb,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "responsibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"position_ref" text,
	"text" text,
	"skills" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skills_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"skill" text,
	"proficiency" text,
	"ats_keyword_variants" jsonb DEFAULT '[]'::jsonb,
	"star_evidence" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "star_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"star_ref" text,
	"text" text,
	"skills" jsonb DEFAULT '[]'::jsonb,
	"ats_keywords" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "star_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"star_ref" text,
	"attribute" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "star_competences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"star_ref" text,
	"competence" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "star_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"star_ref" text,
	"text" text,
	"metric" text,
	"impact_type" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_code" text,
	"position_ref" text,
	"title" text,
	"summary" text,
	"obsidian_note_ref" text
);
