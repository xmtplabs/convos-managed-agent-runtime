CREATE TABLE "instance_infra" (
	"instance_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'railway' NOT NULL,
	"provider_service_id" text NOT NULL,
	"provider_env_id" text NOT NULL,
	"provider_project_id" text,
	"url" text,
	"deploy_status" text,
	"runtime_image" text,
	"gateway_token" text,
	"runtime_version" text,
	"volume_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_infra_provider_service_id_unique" UNIQUE("provider_service_id")
);
--> statement-breakpoint
CREATE TABLE "instance_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"resource_meta" jsonb DEFAULT '{}'::jsonb,
	"env_key" text NOT NULL,
	"env_value" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_services_instance_id_tool_id_unique" UNIQUE("instance_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"status" text DEFAULT 'starting' NOT NULL,
	"agent_name" text,
	"conversation_id" text,
	"invite_url" text,
	"instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "phone_number_pool" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"messaging_profile_id" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"instance_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_number_pool_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
ALTER TABLE "instance_services" ADD CONSTRAINT "instance_services_instance_id_instance_infra_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instance_infra"("instance_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_instances_status" ON "instances" USING btree ("status");