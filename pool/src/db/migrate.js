import { sql } from "./connection.js";

export async function migrate() {
  // If old table exists, rename and clean up
  const oldTable = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'pool_instances'
  `;

  if (oldTable.rows.length > 0) {
    console.log("Migrating pool_instances → agent_metadata...");

    await sql`ALTER TABLE pool_instances RENAME TO agent_metadata`;

    // Drop unused columns
    await sql`
      DO $$
      BEGIN
        ALTER TABLE agent_metadata DROP COLUMN IF EXISTS railway_url;
        ALTER TABLE agent_metadata DROP COLUMN IF EXISTS status;
        ALTER TABLE agent_metadata DROP COLUMN IF EXISTS health_check_failures;
        ALTER TABLE agent_metadata DROP COLUMN IF EXISTS updated_at;
        ALTER TABLE agent_metadata DROP COLUMN IF EXISTS join_url;
      END $$
    `;

    // Rename claimed_by → agent_name
    await sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'agent_metadata' AND column_name = 'claimed_by'
        ) THEN
          ALTER TABLE agent_metadata RENAME COLUMN claimed_by TO agent_name;
        END IF;
      END $$
    `;

    // Delete non-claimed rows (no useful metadata)
    const deleted = await sql`DELETE FROM agent_metadata WHERE agent_name IS NULL`;
    console.log(`  Cleaned ${deleted.rowCount || 0} non-claimed rows`);

    // Match fresh install schema: agent_name should be NOT NULL
    await sql`ALTER TABLE agent_metadata ALTER COLUMN agent_name SET NOT NULL`;

    console.log("Migration complete.");
  } else {
    // Check if agent_metadata already exists (idempotent)
    const newTable = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'agent_metadata'
    `;

    if (newTable.rows.length > 0) {
      console.log("agent_metadata table already exists. Nothing to do.");
    } else {
      // Fresh install — create agent_metadata directly
      await sql`
        CREATE TABLE agent_metadata (
          id TEXT PRIMARY KEY,
          railway_service_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          conversation_id TEXT,
          invite_url TEXT,
          instructions TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          claimed_at TIMESTAMPTZ DEFAULT NOW(),
          source_branch TEXT
        )
      `;
      console.log("Created agent_metadata table.");
    }
  }

  // Add columns if missing (idempotent)
  await sql`ALTER TABLE agent_metadata ADD COLUMN IF NOT EXISTS source_branch TEXT`;
  await sql`ALTER TABLE agent_metadata ADD COLUMN IF NOT EXISTS openrouter_key_hash TEXT`;
  await sql`ALTER TABLE agent_metadata ADD COLUMN IF NOT EXISTS agentmail_inbox_id TEXT`;

  // --- Phase 2: Create `instances` table (replaces in-memory cache) ---
  const instancesTable = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'instances'
  `;

  if (instancesTable.rows.length === 0) {
    console.log("Creating instances table...");
    await sql`
      CREATE TABLE instances (
        id TEXT PRIMARY KEY,
        service_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        url TEXT,
        status TEXT NOT NULL DEFAULT 'starting',
        deploy_status TEXT,
        agent_name TEXT,
        conversation_id TEXT,
        invite_url TEXT,
        instructions TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        source_branch TEXT,
        openrouter_key_hash TEXT,
        agentmail_inbox_id TEXT,
        gateway_token TEXT
      )
    `;
    await sql`CREATE INDEX idx_instances_status ON instances (status)`;
    await sql`CREATE INDEX idx_instances_service_id ON instances (service_id)`;
    console.log("Created instances table.");

    // Migrate existing agent_metadata rows (these are claimed instances)
    const migrated = await sql`
      INSERT INTO instances (id, service_id, name, status, agent_name, conversation_id, invite_url, instructions, created_at, claimed_at, source_branch, openrouter_key_hash, agentmail_inbox_id)
      SELECT id, railway_service_id, 'convos-agent-' || id, 'claimed', agent_name, conversation_id, invite_url, instructions, created_at, claimed_at, source_branch, openrouter_key_hash, agentmail_inbox_id
      FROM agent_metadata
      ON CONFLICT (id) DO NOTHING
    `;
    console.log(`  Migrated ${migrated.rowCount || 0} agent_metadata row(s) into instances.`);
  } else {
    console.log("instances table already exists.");
  }

  // Add columns if missing (idempotent)
  await sql`ALTER TABLE instances ADD COLUMN IF NOT EXISTS runtime_image TEXT`;

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
