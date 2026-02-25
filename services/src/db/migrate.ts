import { sql } from "./connection.js";

export async function migrate() {
  // instance_infra: tracks provider-level infrastructure per instance
  const infraTable = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'instance_infra'
  `;

  if (infraTable.rows.length === 0) {
    console.log("[migrate] Creating instance_infra table...");
    await sql`
      CREATE TABLE instance_infra (
        instance_id         TEXT PRIMARY KEY,
        provider            TEXT NOT NULL DEFAULT 'railway',
        provider_service_id TEXT NOT NULL UNIQUE,
        provider_env_id     TEXT NOT NULL,
        url                 TEXT,
        deploy_status       TEXT,
        runtime_image       TEXT,
        volume_id           TEXT,
        gateway_token       TEXT,
        setup_password      TEXT,
        wallet_key          TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log("[migrate] Created instance_infra table.");
  } else {
    console.log("[migrate] instance_infra table already exists.");
  }

  // instance_services: tracks per-tool provisioned resources
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
