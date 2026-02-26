import { pgTable, text, timestamp, index, serial, jsonb, unique, integer } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export type InstanceStatus = "starting" | "idle" | "claimed" | "crashed" | "claiming" | "dead" | "sleeping";

// ── instances ──────────────────────────────────────────────────────────────────
export const instances = pgTable("instances", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url"),
  status: text("status").$type<InstanceStatus>().notNull().default("starting"),
  agentName: text("agent_name"),
  conversationId: text("conversation_id"),
  inviteUrl: text("invite_url"),
  instructions: text("instructions"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  index("idx_instances_status").on(table.status),
]);

// ── instance_infra ─────────────────────────────────────────────────────────────
export const instanceInfra = pgTable("instance_infra", {
  instanceId: text("instance_id").primaryKey(),
  provider: text("provider").notNull().default("railway"),
  providerServiceId: text("provider_service_id").notNull().unique(),
  providerEnvId: text("provider_env_id").notNull(),
  providerProjectId: text("provider_project_id"),
  url: text("url"),
  deployStatus: text("deploy_status"),
  runtimeImage: text("runtime_image"),
  gatewayToken: text("gateway_token"),
  volumeId: text("volume_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// ── instance_services ──────────────────────────────────────────────────────────
export const instanceServices = pgTable("instance_services", {
  id: serial("id").primaryKey(),
  instanceId: text("instance_id").notNull().references(() => instanceInfra.instanceId, { onDelete: "cascade" }),
  toolId: text("tool_id").notNull(),
  resourceId: text("resource_id").notNull(),
  resourceMeta: jsonb("resource_meta").$type<Record<string, unknown>>().default({}),
  envKey: text("env_key").notNull(),
  envValue: text("env_value"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  unique().on(table.instanceId, table.toolId),
]);

// ── phone_number_pool ─────────────────────────────────────────────────────────
export type PhonePoolStatus = "available" | "assigned";

export const phoneNumberPool = pgTable("phone_number_pool", {
  id: serial("id").primaryKey(),
  phoneNumber: text("phone_number").unique().notNull(),
  messagingProfileId: text("messaging_profile_id").notNull(),
  status: text("status").$type<PhonePoolStatus>().notNull().default("available"),
  instanceId: text("instance_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// ── Inferred types ─────────────────────────────────────────────────────────────
export type InstanceRow = InferSelectModel<typeof instances>;
export type NewInstance = InferInsertModel<typeof instances>;
export type InfraRow = InferSelectModel<typeof instanceInfra>;
export type NewInfra = InferInsertModel<typeof instanceInfra>;
export type ServiceRow = InferSelectModel<typeof instanceServices>;
export type NewService = InferInsertModel<typeof instanceServices>;
export type PhonePoolRow = InferSelectModel<typeof phoneNumberPool>;
export type NewPhonePool = InferInsertModel<typeof phoneNumberPool>;
