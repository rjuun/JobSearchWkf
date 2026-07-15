ALTER TABLE "bullet_bank" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "bullet_bank" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "education" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "education" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "languages" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "languages" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "responsibilities" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "responsibilities" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "skills_master" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "skills_master" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "star_actions" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "star_actions" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "star_attributes" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "star_attributes" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "star_competences" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "star_competences" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "star_results" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "star_results" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "stars" ADD COLUMN "source" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "stars" ADD COLUMN "confidence" real;