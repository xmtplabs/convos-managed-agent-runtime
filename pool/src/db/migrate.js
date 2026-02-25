import { sql } from "./connection.js";

export async function migrate() {
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

    // Drop columns that now live in services DB
    for (const col of ["service_id", "deploy_status", "volume_id", "runtime_image"]) {
      await sql.unsafe(`ALTER TABLE instances DROP COLUMN IF EXISTS ${col}`);
    }

    // Drop index that referenced service_id
    await sql`DROP INDEX IF EXISTS idx_instances_service_id`;

    console.log("Ensured legacy columns (service_id, deploy_status, volume_id, runtime_image) are dropped.");
  }
}

// Run as standalone script: node src/db/migrate.js
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
