import pg from "pg";
import { config } from "../config";

/**
 * Idempotent migrations — safe to run repeatedly.
 *
 * Schema:
 *   instances          — lean lifecycle table
 *   instance_infra     — Railway service / infra details
 *   instance_services  — provisioned tool resources
 *   phone_number_pool  — reusable Telnyx numbers
 */

async function query(pool: pg.Pool, text: string, params?: unknown[]) {
  return pool.query(text, params);
}

/** Returns true if a table exists. */
async function tableExists(pool: pg.Pool, table: string): Promise<boolean> {
  const { rows } = await query(
    pool,
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

export async function runMigrations() {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5000,
  });

  try {
    // ── 1. Ensure instances table exists (fresh install) ───────────────
    if (!(await tableExists(pool, "instances"))) {
      console.log("[migrate] Creating instances table...");
      await query(pool, `
        CREATE TABLE instances (
          id               TEXT PRIMARY KEY,
          name             TEXT NOT NULL,
          url              TEXT,
          status           TEXT NOT NULL DEFAULT 'starting',
          agent_name       TEXT,
          conversation_id  TEXT,
          invite_url       TEXT,
          instructions     TEXT,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          claimed_at       TIMESTAMPTZ
        )
      `);
      await query(pool, `CREATE INDEX idx_instances_status ON instances (status)`);
      console.log("[migrate] Created instances table.");
    } else {
      console.log("[migrate] instances table already exists.");
    }

    // ── 2. Create instance_infra if missing ────────────────────────────
    if (!(await tableExists(pool, "instance_infra"))) {
      console.log("[migrate] Creating instance_infra table...");
      await query(pool, `
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
      `);
      console.log("[migrate] Created instance_infra table.");
    } else {
      console.log("[migrate] instance_infra table already exists.");
      // Ensure provider_project_id column exists (older installs)
      await query(pool, `ALTER TABLE instance_infra ADD COLUMN IF NOT EXISTS provider_project_id TEXT`);
    }

    // ── 3. Create instance_services if missing ─────────────────────────
    if (!(await tableExists(pool, "instance_services"))) {
      console.log("[migrate] Creating instance_services table...");
      await query(pool, `
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
      `);
      console.log("[migrate] Created instance_services table.");
    } else {
      console.log("[migrate] instance_services table already exists.");
    }

    // ── 4. Create phone_number_pool if missing ────────────────────────
    if (!(await tableExists(pool, "phone_number_pool"))) {
      console.log("[migrate] Creating phone_number_pool table...");
      await query(pool, `
        CREATE TABLE phone_number_pool (
          id                    SERIAL PRIMARY KEY,
          phone_number          TEXT UNIQUE NOT NULL,
          messaging_profile_id  TEXT NOT NULL,
          status                TEXT NOT NULL DEFAULT 'available',
          instance_id           TEXT,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      console.log("[migrate] Created phone_number_pool table.");
    } else {
      console.log("[migrate] phone_number_pool table already exists.");
    }

    console.log("[migrate] All migrations complete.");
  } finally {
    await pool.end();
  }
}

// Run as standalone script: pnpm db:migrate
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[migrate] Failed:", err);
      process.exit(1);
    });
}
