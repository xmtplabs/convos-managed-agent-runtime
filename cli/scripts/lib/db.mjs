import pg from "pg";

export function connect() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
}

export async function getActiveInboxIds(pool) {
  const { rows } = await pool.query(
    "SELECT agentmail_inbox_id FROM agent_metadata WHERE agentmail_inbox_id IS NOT NULL"
  );
  return new Set(rows.map((r) => r.agentmail_inbox_id));
}

export async function getActiveKeyHashes(pool) {
  const { rows } = await pool.query(
    "SELECT openrouter_key_hash FROM agent_metadata WHERE openrouter_key_hash IS NOT NULL"
  );
  return new Set(rows.map((r) => r.openrouter_key_hash));
}

export async function disconnect(pool) {
  await pool.end();
}
