ALTER TABLE "llm_calls" ADD COLUMN "status" text DEFAULT 'ok';--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "attempts" integer DEFAULT 1;