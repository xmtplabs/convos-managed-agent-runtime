import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.SERVICE_DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.warn("[db] Idle client error:", err.message);
});

/**
 * Tagged-template helper: sql`SELECT * FROM t WHERE id = ${v}`
 * Converts to parameterized query and returns { rows, rowCount }.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.reduce(
    (prev, curr, i) => `${prev}$${i}${curr}`,
  );
  return pool.query(text, values);
}

export { pool };
