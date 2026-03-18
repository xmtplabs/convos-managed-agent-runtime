# Switch Pool Migrations to Drizzle Kit

## Current state

We already use Drizzle ORM for all database queries and schema definitions:

- **`pool/src/db/schema.ts`** — Drizzle schema definitions for all 4 tables (`instances`, `instance_infra`, `instance_services`, `phone_number_pool`), plus inferred TypeScript types
- **`pool/src/db/connection.ts`** — Drizzle ORM initialized with `drizzle(pool, { schema })`, used throughout the codebase for type-safe queries
- **`drizzle-kit@0.31.9`** — already installed as a dev dependency
- **`pool/drizzle.config.ts`** — already configured, pointing at `schema.ts` with output to `./drizzle`
- **`db:generate`, `db:push`, `db:studio`** — scripts already wired up in `pool/package.json`

However, migrations are handled separately via hand-written idempotent SQL in `pool/src/db/migrate.ts`. This file uses raw `pg` queries (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`) and has no connection to the Drizzle schema. The two must be kept in sync manually.

## Problem

`schema.ts` and `migrate.ts` can drift apart with no guardrail. Multiple contributors have already hit schema conflicts from this. As we add more tables (templates, etc.), maintaining two parallel definitions of the schema becomes increasingly fragile.

## Proposal

Use the Drizzle Kit migration system we already have installed. Drizzle Kit diffs `schema.ts` against a snapshot, generates numbered SQL files, and tracks what's been applied in a `__drizzle_migrations` journal table. This makes `schema.ts` the single source of truth for both queries and migrations.

## Why not upgrade drizzle-kit?

The newer `drizzle-kit@1.0.0-beta` has a `pull --init` command that handles baseline seeding automatically. However:

- There is no stable 1.0.0 release — `0.31.9` is still the `latest` npm tag
- Upgrading `drizzle-kit` to beta requires also upgrading `drizzle-orm` to beta (they're coupled), turning a dev dependency change into a production runtime change
- The beta has critical open bugs: silent migration skipping ([#5316](https://github.com/drizzle-team/drizzle-orm/issues/5316)), removed safety checks for destructive operations ([#5249](https://github.com/drizzle-team/drizzle-orm/issues/5249))
- Migrations generated with beta use a new v3 format incompatible with 0.31.9 — a one-way door

We stay on `0.31.9` and handle the baseline manually instead.

## New workflow for schema changes

1. Edit `schema.ts`
2. Run `pnpm db:generate` — produces a timestamped SQL file in `pool/drizzle/`
3. Commit the migration file alongside the schema change
4. On deploy, migrations run automatically on startup (same as today)

## What changes

### `pool/src/db/migrate.ts`

Rewrite to use Drizzle's migrator, with a one-time `seedBaseline()` to handle existing databases:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import fs from "fs";
import pg from "pg";
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
 * Safe to leave in place — it's a no-op once the migrations table exists.
 * Can be removed once all environments (dev, staging, prod) have been migrated.
 */
async function seedBaseline(pool: pg.Pool) {
  // Already initialized — nothing to do
  const { rows: migrationTable } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'`
  );
  if (migrationTable.length > 0) return;

  // Fresh database — let Drizzle create everything normally
  const { rows: existingTables } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'instances'`
  );
  if (existingTables.length === 0) return;

  // Existing database without Drizzle tracking — seed the baseline
  const journal = JSON.parse(
    fs.readFileSync("./drizzle/meta/_journal.json", "utf-8")
  );
  const first = journal.entries[0];

  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
    )
  `);
  await pool.query(
    `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
    [first.hash, first.when]
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
```

### `pool/drizzle/`

New directory, committed to git. Generated by `drizzle-kit generate`. Contains:

- `meta/_journal.json` — migration journal (tracks order and hashes)
- `meta/0000_snapshot.json` — schema snapshot
- `0000_initial.sql` — baseline migration with strict `CREATE TABLE` statements

Do **not** edit the generated SQL. The strict `CREATE TABLE` is correct — it ensures fresh databases get the full schema. The `seedBaseline()` function handles skipping it on existing databases.

### `pool/Dockerfile`

Add `COPY drizzle ./drizzle` so migration files are available at runtime. The Dockerfile uses `WORKDIR /app`, so `./drizzle` in `migrate.ts` resolves to `/app/drizzle`.

```dockerfile
COPY drizzle ./drizzle
```

### Everything else

No changes to:

- **`pool/src/index.ts`** — already calls `runMigrations()` on startup
- **`pool/src/db/schema.ts`** — already the source of truth
- **`pool/src/db/connection.ts`** — unchanged
- **`pool/package.json` scripts** — `db:migrate` runs the same file, `db:generate` already wired up

## Generating the baseline

1. Run `cd pool && pnpm db:generate` — Drizzle Kit diffs `schema.ts` against an empty state and produces the baseline SQL
2. Commit the `drizzle/` directory

## Deployment sequence

1. **Deploy to dev** — pool manager restarts, `seedBaseline()` detects existing tables without `__drizzle_migrations`, inserts the baseline record, then `migrate()` sees no pending migrations. No-op.
2. **Verify on dev** — confirm `drizzle.__drizzle_migrations` has exactly 1 row, app is healthy
3. **Promote to staging** — same behavior
4. **Promote to main** — same behavior

## Verification

After deploying to each environment, confirm:

```sql
SELECT * FROM drizzle.__drizzle_migrations;
-- Should show 1 row with the baseline hash
```

And confirm the pool manager starts and serves traffic normally.

## Risks

- **Baseline mismatch** — if `schema.ts` doesn't exactly match production, future migrations will diff against the wrong baseline. Mitigation: verify `schema.ts` against actual prod schema before generating.

## Size

Small PR. Rewrites 1 file (`migrate.ts`), updates the Dockerfile, adds the `drizzle/` directory with the baseline migration.
