ALTER TABLE "agent_skills" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "emoji" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "tools" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_skills" RENAME COLUMN "instructions" TO "prompt";--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_slug_unique" UNIQUE("slug");
