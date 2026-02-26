import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./connection";

export async function runMigrations() {
  console.log("[migrate] Running Drizzle migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] All migrations complete.");
}

// Run as standalone script
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[migrate] Failed:", err);
      process.exit(1);
    });
}
