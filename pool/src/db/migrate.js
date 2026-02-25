import { sql } from "./connection.js";

export async function migrate({ drop = false } = {}) {
  const exists = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'instances'
  `;

  if (exists.rows.length === 0) {
    console.log("Creating instances table...");
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
    console.log("Created instances table.");
  } else {
    console.log("instances table already exists.");

    if (drop) {
      // Drop columns that now live in services DB or are unused
      const dropCols = [
        "service_id",          // moved to services instance_infra
        "deploy_status",       // fetched from batch status API
        "volume_id",           // moved to services instance_infra
        "runtime_image",       // fetched from batch status API
        "openrouter_key_hash", // moved to services instance_services
        "agentmail_inbox_id",  // moved to services instance_services
        "gateway_token",       // generated at runtime
        "source_branch",       // unused
      ];
      for (const col of dropCols) {
        await sql.unsafe(`ALTER TABLE instances DROP COLUMN IF EXISTS ${col}`);
      }

      // Drop index that referenced service_id
      await sql`DROP INDEX IF EXISTS idx_instances_service_id`;

      console.log(`Dropped legacy columns (${dropCols.join(", ")}) (--drop).`);
    }
  }
}

// Run as standalone script: node src/db/migrate.js [--drop]
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const drop = process.argv.includes("--drop");
  if (drop) console.log("[migrate] Running with --drop (destructive column drops enabled)");
  migrate({ drop })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
