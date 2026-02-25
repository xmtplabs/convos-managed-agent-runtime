import pg from "pg";
import { sql, pool as servicesPool } from "./connection.js";
import { config } from "../config.js";
import { fetchAllVolumesByService } from "../providers/railway.js";

export async function migrate() {
  // ── Services tables ────────────────────────────────────────────────────

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

  // Drop legacy secret columns from instance_infra (generated at runtime, never needed in DB)
  for (const col of ["gateway_token", "setup_password", "wallet_key"]) {
    await servicesPool.query(`ALTER TABLE instance_infra DROP COLUMN IF EXISTS ${col}`);
  }

  // ── Pool DB: backfill + cleanup ────────────────────────────────────────

  if (config.poolDatabaseUrl) {
    await backfillAndCleanPool();
  }
}

/**
 * Connects to pool DB, backfills instance_infra/instance_services from
 * pool's instances table, then cleans up legacy tables and columns.
 * Idempotent — skips backfill if instance_infra already has rows.
 */
async function backfillAndCleanPool() {
  const poolDb = new pg.Pool({
    connectionString: config.poolDatabaseUrl,
    max: 2,
    connectionTimeoutMillis: 5000,
  });

  try {
    // ── Backfill ──────────────────────────────────────────────────────

    const existing = await sql`SELECT COUNT(*) AS cnt FROM instance_infra`;
    const count = parseInt(existing.rows[0].cnt, 10);

    // Check which columns exist (some may already be dropped)
    const colCheck = await poolDb.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'instances'"
    );
    const poolCols = new Set(colCheck.rows.map((r: any) => r.column_name));

    if (count === 0) {
      console.log("[migrate] Backfilling from pool DB...");

      if (poolCols.has("service_id")) {
        const baseCols = ["id", "service_id", "name", "url", "status", "deploy_status", "created_at"]
          .filter((c) => poolCols.has(c));
        const optCols = ["runtime_image", "volume_id", "openrouter_key_hash", "agentmail_inbox_id"]
          .filter((c) => poolCols.has(c));

        const { rows } = await poolDb.query(
          `SELECT ${[...baseCols, ...optCols].join(", ")} FROM instances WHERE service_id IS NOT NULL`
        );

        const envId = config.railwayEnvironmentId || "unknown";
        let infraCount = 0;
        let svcCount = 0;

        for (const row of rows) {
          await sql`
            INSERT INTO instance_infra (instance_id, provider, provider_service_id, provider_env_id, url, deploy_status, runtime_image, volume_id, created_at)
            VALUES (${row.id}, 'railway', ${row.service_id}, ${envId}, ${row.url}, ${row.deploy_status}, ${row.runtime_image || null}, ${row.volume_id || null}, ${row.created_at})
            ON CONFLICT (instance_id) DO NOTHING
          `;
          infraCount++;

          if (row.openrouter_key_hash) {
            await sql`
              INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value)
              VALUES (${row.id}, 'openrouter', ${row.openrouter_key_hash}, 'OPENROUTER_API_KEY', NULL)
              ON CONFLICT (instance_id, tool_id) DO NOTHING
            `;
            svcCount++;
          }

          if (row.agentmail_inbox_id) {
            await sql`
              INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value)
              VALUES (${row.id}, 'agentmail', ${row.agentmail_inbox_id}, 'AGENTMAIL_INBOX_ID', ${row.agentmail_inbox_id})
              ON CONFLICT (instance_id, tool_id) DO NOTHING
            `;
            svcCount++;
          }
        }

        console.log(`[migrate] Backfilled ${infraCount} instance_infra, ${svcCount} instance_services row(s).`);
      } else {
        console.log("[migrate] Pool instances table has no service_id column, skipping backfill.");
      }
    } else {
      console.log(`[migrate] instance_infra already has ${count} row(s), skipping backfill.`);
    }

    // ── Patch volume_id on existing rows ──────────────────────────────

    // Find rows missing volume_id in services DB
    const { rows: nullVolumes } = await sql`
      SELECT instance_id, provider_service_id FROM instance_infra WHERE volume_id IS NULL
    `;
    console.log(`[migrate] instance_infra rows missing volume_id: ${nullVolumes.length}`);

    if (nullVolumes.length > 0) {
      // Fetch volume → service mapping from Railway API
      console.log("[migrate] Fetching volumes from Railway API...");
      const volumeMap = await fetchAllVolumesByService();

      if (volumeMap && volumeMap.size > 0) {
        console.log(`[migrate] Railway returned volumes for ${volumeMap.size} service(s).`);
        let patched = 0;

        for (const row of nullVolumes) {
          const vols = volumeMap.get(row.provider_service_id);
          if (vols && vols.length > 0) {
            const volumeId = vols[0];
            // Patch services DB
            await sql`
              UPDATE instance_infra SET volume_id = ${volumeId}
              WHERE instance_id = ${row.instance_id}
            `;
            // Patch pool DB only if it still has the volume_id column
            if (poolCols.has("volume_id")) {
              await poolDb.query(
                "UPDATE instances SET volume_id = $1 WHERE id = $2",
                [volumeId, row.instance_id]
              );
            }
            patched++;
            console.log(`[migrate] Patched volume_id=${volumeId} for instance ${row.instance_id} (service ${row.provider_service_id})`);
          } else {
            console.log(`[migrate] No volume found for instance ${row.instance_id} (service ${row.provider_service_id})`);
          }
        }
        console.log(`[migrate] Patched volume_id on ${patched}/${nullVolumes.length} row(s).`);
      } else {
        console.log("[migrate] No volumes returned from Railway (missing RAILWAY_API_TOKEN or no volumes).");
      }
    }

    console.log("[migrate] Pool DB backfill/cleanup complete.");
  } catch (err: any) {
    console.warn(`[migrate] Pool DB backfill/cleanup failed (non-fatal): ${err.message}`);
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
