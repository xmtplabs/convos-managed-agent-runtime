import { sql } from "./connection.js";
import { config } from "../config.js";

export async function migrate() {
  // ── Pool table: instances ──────────────────────────────────────────────
  const instancesTable = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'instances'
  `;

  if (instancesTable.rows.length === 0) {
    console.log("[migrate] Creating instances table...");
    await sql`
      CREATE TABLE instances (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT,
        status TEXT NOT NULL DEFAULT 'starting',
        agent_name TEXT,
        conversation_id TEXT,
        invite_url TEXT,
        instructions TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX idx_instances_status ON instances (status)`;
    console.log("[migrate] Created instances table.");
  } else {
    console.log("[migrate] instances table already exists.");
  }

  // ── Services table: instance_infra ─────────────────────────────────────
  const infraTable = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'instance_infra'
  `;

  if (infraTable.rows.length === 0) {
    console.log("[migrate] Creating instance_infra table...");
    await sql`
      CREATE TABLE instance_infra (
        instance_id          TEXT PRIMARY KEY,
        provider             TEXT NOT NULL DEFAULT 'railway',
        provider_service_id  TEXT NOT NULL UNIQUE,
        provider_env_id      TEXT NOT NULL,
        provider_project_id  TEXT,
        url                  TEXT,
        deploy_status        TEXT,
        runtime_image        TEXT,
        volume_id            TEXT,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log("[migrate] Created instance_infra table.");
  } else {
    console.log("[migrate] instance_infra table already exists.");
  }

  // ── Services table: instance_services ──────────────────────────────────
  const servicesTable = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'instance_services'
  `;

  if (servicesTable.rows.length === 0) {
    console.log("[migrate] Creating instance_services table...");
    await sql`
      CREATE TABLE instance_services (
        id            SERIAL PRIMARY KEY,
        instance_id   TEXT NOT NULL REFERENCES instance_infra(instance_id) ON DELETE CASCADE,
        tool_id       TEXT NOT NULL,
        resource_id   TEXT NOT NULL,
        resource_meta JSONB DEFAULT '{}',
        env_key       TEXT NOT NULL,
        env_value     TEXT,
        status        TEXT NOT NULL DEFAULT 'active',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(instance_id, tool_id)
      )
    `;
    console.log("[migrate] Created instance_services table.");
  } else {
    console.log("[migrate] instance_services table already exists.");
  }

  // ── Add provider_project_id to instance_infra (existing DBs) ──────────
  await sql`ALTER TABLE instance_infra ADD COLUMN IF NOT EXISTS provider_project_id TEXT`;
  if (config.railwayProjectId) {
    await sql`
      UPDATE instance_infra SET provider_project_id = ${config.railwayProjectId}
      WHERE provider_project_id IS NULL
    `;
  }

  console.log("[migrate] All migrations complete.");
}

// Run as standalone script
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[migrate] Failed:", err);
      process.exit(1);
    });
}
