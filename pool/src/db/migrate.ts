import pg from "pg";
import { config } from "../config";

/**
 * Imperative migration that bridges the old flat `instances` schema (dev)
 * to the new normalised 3-table schema used by Drizzle.
 *
 * Idempotent — safe to run repeatedly.  Non-fatal on backfill failure.
 *
 * Old dev schema (instances):
 *   id, service_id, name, url, status, deploy_status, agent_name,
 *   conversation_id, invite_url, instructions, created_at, claimed_at,
 *   source_branch, openrouter_key_hash, agentmail_inbox_id, gateway_token
 *
 * New schema:
 *   instances       — lean lifecycle table
 *   instance_infra  — Railway service / infra details
 *   instance_services — provisioned tool resources
 */

async function query(pool: pg.Pool, text: string, params?: unknown[]) {
  return pool.query(text, params);
}

/** Returns the set of column names for a table. */
async function columnSet(pool: pg.Pool, table: string): Promise<Set<string>> {
  const { rows } = await query(
    pool,
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [table],
  );
  return new Set(rows.map((r: any) => r.column_name));
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

    // ── 4. Backfill instance_infra from old instances rows ─────────────
    const cols = await columnSet(pool, "instances");

    if (cols.has("service_id")) {
      const { rows: infraCount } = await query(pool, `SELECT COUNT(*) AS cnt FROM instance_infra`);
      const count = parseInt(infraCount[0].cnt, 10);

      if (count === 0) {
        console.log("[migrate] Backfilling instance_infra from old instances table...");

        const envId = config.railwayEnvironmentId || "unknown";
        const projectId = config.railwayProjectId || null;

        const { rows } = await query(pool, `
          SELECT id, service_id, url, deploy_status,
                 ${cols.has("runtime_image") ? "runtime_image," : ""}
                 ${cols.has("openrouter_key_hash") ? "openrouter_key_hash," : ""}
                 ${cols.has("agentmail_inbox_id") ? "agentmail_inbox_id," : ""}
                 created_at
          FROM instances
          WHERE service_id IS NOT NULL
        `);

        let infraInserted = 0;
        let svcInserted = 0;

        for (const row of rows) {
          // Insert infra row
          await query(pool, `
            INSERT INTO instance_infra
              (instance_id, provider, provider_service_id, provider_env_id, provider_project_id, url, deploy_status, runtime_image, created_at)
            VALUES ($1, 'railway', $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (instance_id) DO NOTHING
          `, [row.id, row.service_id, envId, projectId, row.url, row.deploy_status, row.runtime_image || null, row.created_at]);
          infraInserted++;

          // Backfill openrouter service row
          if (row.openrouter_key_hash) {
            await query(pool, `
              INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value)
              VALUES ($1, 'openrouter', $2, 'OPENROUTER_API_KEY', NULL)
              ON CONFLICT (instance_id, tool_id) DO NOTHING
            `, [row.id, row.openrouter_key_hash]);
            svcInserted++;
          }

          // Backfill agentmail service row
          if (row.agentmail_inbox_id) {
            await query(pool, `
              INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value)
              VALUES ($1, 'agentmail', $2, 'AGENTMAIL_INBOX_ID', $3)
              ON CONFLICT (instance_id, tool_id) DO NOTHING
            `, [row.id, row.agentmail_inbox_id, row.agentmail_inbox_id]);
            svcInserted++;
          }
        }

        console.log(`[migrate] Backfilled ${infraInserted} infra + ${svcInserted} service row(s).`);
      } else {
        console.log(`[migrate] instance_infra already has ${count} row(s), skipping backfill.`);
      }

      // ── 5. Drop legacy columns from instances ──────────────────────
      // TODO: uncomment once all environments are on the new schema
      // console.log("[migrate] Dropping legacy columns from instances...");
      // const legacyCols = ["service_id", "deploy_status", "source_branch", "openrouter_key_hash", "agentmail_inbox_id", "gateway_token"];
      // for (const col of legacyCols) {
      //   await query(pool, `ALTER TABLE instances DROP COLUMN IF EXISTS ${col}`);
      // }
      // await query(pool, `DROP INDEX IF EXISTS idx_instances_service_id`);
      // console.log("[migrate] Legacy columns dropped.");
    } else {
      console.log("[migrate] instances table already has new schema (no service_id), skipping backfill.");
    }

    // ── 6. Backfill provider_project_id if set ─────────────────────────
    if (config.railwayProjectId) {
      await query(pool, `
        UPDATE instance_infra SET provider_project_id = $1
        WHERE provider_project_id IS NULL
      `, [config.railwayProjectId]);
    }

    // ── 7. Drop legacy agent_metadata table ────────────────────────────
    // TODO: uncomment once all environments are on the new schema
    // if (await tableExists(pool, "agent_metadata")) {
    //   console.log("[migrate] Dropping legacy agent_metadata table...");
    //   await query(pool, `DROP TABLE agent_metadata`);
    //   console.log("[migrate] Dropped agent_metadata.");
    // }

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
