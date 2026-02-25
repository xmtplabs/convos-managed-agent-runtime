import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.POOL_DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Prevent unhandled 'error' from crashing the process on idle connection drops
pool.on("error", (err) => {
  console.warn("[db] Idle client error:", err.message);
});

/**
 * Tagged-template helper that turns sql`SELECT * FROM t WHERE id = ${v}`
 * into a parameterized query and returns { rows, rowCount }.
 */
export function sql(strings, ...values) {
  const text = strings.reduce(
    (prev, curr, i) => `${prev}$${i}${curr}`,
  );
  return pool.query(text, values);
}

export { pool };
