CREATE TABLE "agent_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"agent_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"emoji" text DEFAULT '' NOT NULL,
	"tools" text[] DEFAULT '{}' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "idx_skills_category" ON "agent_skills" USING btree ("category");
