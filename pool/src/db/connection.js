import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

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
