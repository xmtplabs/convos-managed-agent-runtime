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

export async function disconnect(pool) {
  await pool.end();
}
