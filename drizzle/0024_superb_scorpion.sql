ALTER TABLE "applications" ADD COLUMN "confirmation_email_link" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "outcome_email_link" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "outcome_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "interview_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "thanks_replied_at" timestamp with time zone;