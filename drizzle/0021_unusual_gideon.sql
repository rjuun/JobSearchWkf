ALTER TABLE "llm_calls" ADD COLUMN "cache_creation_tokens" integer;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "cache_read_tokens" integer;