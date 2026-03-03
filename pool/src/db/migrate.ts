import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { config } from "../config";

export async function runMigrations() {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5000,
  });

  try {
    await seedBaseline(pool);

    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[migrate] All migrations complete.");
  } finally {
    await pool.end();
  }
}

/**
 * One-time seed for existing databases.
 *
 * drizzle-kit@0.31.9 generates strict CREATE TABLE (no IF NOT EXISTS),
 * so running the baseline migration against a database that already has
 * tables will fail. This function detects that scenario and inserts a
 * record into __drizzle_migrations so the baseline is skipped.
 *
 * Handles three scenarios:
 *   1. __drizzle_migrations has records → already initialized, skip
 *   2. instances table missing    → fresh DB, let Drizzle create everything
 *   3. instances exists, no tracking → existing DB, seed the baseline record
 *
 * Safe to leave in place — it's a no-op once the migrations table exists.
 * Can be removed once all environments (dev, staging, prod) have been migrated.
 */
async function seedBaseline(pool: pg.Pool) {
  // Check for existing baseline record (not just table existence) to avoid
  // a race where the table is created but the record isn't yet inserted.
  const { rows: baselineRows } = await pool.query(
    `SELECT 1 FROM "drizzle"."__drizzle_migrations" LIMIT 1`
  ).catch(() => ({ rows: [] }));
  if (baselineRows.length > 0) return;

  const { rows: existingTables } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'instances'`
  );
  if (existingTables.length === 0) return;

  // Backfill columns that older installs may be missing.
  // The old hand-written migrate.ts ran these on every startup; once the baseline
  // is seeded those ALTER TABLEs won't run again, so we do it here.
  await pool.query(`ALTER TABLE instance_infra ADD COLUMN IF NOT EXISTS provider_project_id TEXT`);
  await pool.query(`ALTER TABLE instance_infra ADD COLUMN IF NOT EXISTS gateway_token TEXT`);
  await pool.query(`ALTER TABLE instance_infra ADD COLUMN IF NOT EXISTS runtime_version TEXT`);

  // Read the journal to find the baseline migration's timestamp,
  // then compute the SHA-256 hash of the SQL file (matches how Drizzle tracks migrations).
  const journal = JSON.parse(
    fs.readFileSync("./drizzle/meta/_journal.json", "utf-8")
  );
  const first = journal.entries[0];
  const sql = fs.readFileSync(`./drizzle/${first.tag}.sql`, "utf-8");
  const hash = crypto.createHash("sha256").update(sql).digest("hex");

  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
    )
  `);
  await pool.query(
    `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
    [hash, first.when]
  );
  console.log("[migrate] Seeded baseline migration for existing database.");
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
