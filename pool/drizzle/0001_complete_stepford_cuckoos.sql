CREATE TABLE "agent_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_skills_creator" ON "agent_skills" USING btree ("creator_id");