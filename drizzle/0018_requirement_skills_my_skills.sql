ALTER TABLE "requirement_tailoring" RENAME COLUMN "actual_skills" TO "my_skills";
ALTER TABLE "requirement_tailoring" ADD COLUMN "requirement_skills" jsonb DEFAULT '[]'::jsonb;
