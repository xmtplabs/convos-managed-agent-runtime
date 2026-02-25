import pg from "pg";
import { sql } from "./connection.js";
import { config } from "../config.js";

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

  // Backfill from pool DB if POOL_DATABASE_URL is set and instance_infra is empty
  await backfillFromPool();
}

/**
 * One-time backfill: reads pool's `instances` table and populates
 * instance_infra + instance_services for pre-extraction instances.
 * Only runs when POOL_DATABASE_URL is set. Skips rows that already exist.
 */
async function backfillFromPool() {
  if (!config.poolDatabaseUrl) return;

  const existing = await sql`SELECT COUNT(*) AS cnt FROM instance_infra`;
  const count = parseInt(existing.rows[0].cnt, 10);
  if (count > 0) {
    console.log(`[migrate] instance_infra already has ${count} row(s), skipping backfill.`);
    return;
  }

  console.log("[migrate] POOL_DATABASE_URL set, backfilling from pool DB...");

  const poolDb = new pg.Pool({
    connectionString: config.poolDatabaseUrl,
    max: 2,
    connectionTimeoutMillis: 5000,
  });

  try {
    // Query pool columns dynamically — some may already be dropped
    const colCheck = await poolDb.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'instances'"
    );
    const poolCols = new Set(colCheck.rows.map((r: any) => r.column_name));

    const selectCols = ["id", "service_id", "name", "url", "status", "deploy_status", "created_at"]
      .filter((c) => poolCols.has(c));
    const optionalCols = ["runtime_image", "openrouter_key_hash", "agentmail_inbox_id", "gateway_token"]
      .filter((c) => poolCols.has(c));

    const { rows } = await poolDb.query(
      `SELECT ${[...selectCols, ...optionalCols].join(", ")} FROM instances WHERE service_id IS NOT NULL`
    );

    if (rows.length === 0) {
      console.log("[migrate] No instances found in pool DB.");
      return;
    }

    const envId = config.railwayEnvironmentId || "unknown";
    let infraCount = 0;
    let svcCount = 0;

    for (const row of rows) {
      // Insert instance_infra
      await sql`
        INSERT INTO instance_infra (instance_id, provider, provider_service_id, provider_env_id, url, deploy_status, runtime_image, gateway_token, created_at)
        VALUES (${row.id}, 'railway', ${row.service_id}, ${envId}, ${row.url}, ${row.deploy_status}, ${row.runtime_image}, ${row.gateway_token}, ${row.created_at})
        ON CONFLICT (instance_id) DO NOTHING
      `;
      infraCount++;

      // Insert instance_services for openrouter
      if (row.openrouter_key_hash) {
        await sql`
          INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value)
          VALUES (${row.id}, 'openrouter', ${row.openrouter_key_hash}, 'OPENROUTER_API_KEY', NULL)
          ON CONFLICT (instance_id, tool_id) DO NOTHING
        `;
        svcCount++;
      }

      // Insert instance_services for agentmail
      if (row.agentmail_inbox_id) {
        await sql`
          INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value)
          VALUES (${row.id}, 'agentmail', ${row.agentmail_inbox_id}, 'AGENTMAIL_INBOX_ID', ${row.agentmail_inbox_id})
          ON CONFLICT (instance_id, tool_id) DO NOTHING
        `;
        svcCount++;
      }
    }

    console.log(`[migrate] Backfilled ${infraCount} instance_infra row(s), ${svcCount} instance_services row(s).`);
  } catch (err: any) {
    console.warn(`[migrate] Backfill failed (non-fatal): ${err.message}`);
  } finally {
    await poolDb.end();
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
