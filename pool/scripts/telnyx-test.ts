/**
 * Local Telnyx test script — exercises the phone number pool lifecycle.
 *
 * Usage:  pnpm telnyx:test
 *
 * Subcommands (pass as first arg):
 *   list        — list all Telnyx numbers on the account
 *   pool        — show phone_number_pool table contents
 *   provision   — provision a number (reuse from pool or purchase)
 *   release <n> — release a number back to the pool
 *   seed        — fetch active Telnyx numbers and seed them into the pool
 */

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { phoneNumberPool } from "../src/db/schema";
import { config } from "../src/config";

const TELNYX_API = "https://api.telnyx.com/v2";

function headers() {
  return {
    Authorization: `Bearer ${config.telnyxApiKey}`,
    "Content-Type": "application/json",
  };
}

// ── Telnyx API helpers ──────────────────────────────────────────────────────

async function listTelnyxNumbers() {
  const res = await fetch(
    `${TELNYX_API}/phone_numbers?page[size]=100&filter[status]=active`,
    { headers: headers() },
  );
  const body = (await res.json()) as any;
  return (body?.data ?? []) as Array<{
    id: string;
    phone_number: string;
    status: string;
    messaging_profile_id: string | null;
  }>;
}

// ── DB ──────────────────────────────────────────────────────────────────────

function getDb() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 });
  return { db: drizzle(pool, { schema: { phoneNumberPool } }), pool };
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdList() {
  console.log("\n=== Telnyx Active Numbers ===\n");
  const numbers = await listTelnyxNumbers();
  if (numbers.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const n of numbers) {
    console.log(
      `  ${n.phone_number}  status=${n.status}  messaging_profile=${n.messaging_profile_id ?? "(none)"}`,
    );
  }
  console.log(`\n  Total: ${numbers.length}`);
}

async function cmdPool() {
  const { db, pool } = getDb();
  try {
    console.log("\n=== phone_number_pool table ===\n");
    const rows = await db.select().from(phoneNumberPool);
    if (rows.length === 0) {
      console.log("  (empty)");
      return;
    }
    for (const r of rows) {
      console.log(
        `  [${r.id}] ${r.phoneNumber}  status=${r.status}  instance=${r.instanceId ?? "(none)"}  profile=${r.messagingProfileId}`,
      );
    }
    console.log(`\n  Total: ${rows.length}`);
  } finally {
    await pool.end();
  }
}

async function cmdProvision() {
  // Import the actual provisionPhone to exercise the real code path
  const { provisionPhone } = await import("../src/services/providers/telnyx");
  console.log("\n=== Provisioning phone number ===\n");
  const result = await provisionPhone("test-script");
  console.log(`  Phone:   ${result.phoneNumber}`);
  console.log(`  Profile: ${result.messagingProfileId}`);
  console.log("\n  Done.");
}

async function cmdRelease(phoneNumber: string) {
  const { deletePhone } = await import("../src/services/providers/telnyx");
  console.log(`\n=== Releasing ${phoneNumber} ===\n`);
  const ok = await deletePhone(phoneNumber);
  console.log(ok ? "  Released back to pool." : "  Not found in pool.");
}

async function cmdSeed() {
  console.log("\n=== Seeding pool from Telnyx account ===\n");

  const numbers = await listTelnyxNumbers();
  if (numbers.length === 0) {
    console.log("  No active numbers on Telnyx account.");
    return;
  }

  const { db, pool } = getDb();
  try {
    let inserted = 0;
    let skipped = 0;

    for (const n of numbers) {
      const profileId = n.messaging_profile_id ?? "";
      // Upsert — skip if already in pool
      const result = await db
        .insert(phoneNumberPool)
        .values({
          phoneNumber: n.phone_number,
          messagingProfileId: profileId,
          status: "available",
        })
        .onConflictDoNothing({ target: phoneNumberPool.phoneNumber });

      if (result.rowCount && result.rowCount > 0) {
        console.log(`  + ${n.phone_number}  (profile=${profileId || "none"})`);
        inserted++;
      } else {
        console.log(`  ~ ${n.phone_number}  (already in pool)`);
        skipped++;
      }
    }

    console.log(`\n  Inserted: ${inserted}, Skipped: ${skipped}`);
  } finally {
    await pool.end();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!config.telnyxApiKey) {
    console.error("TELNYX_API_KEY not set. Add it to pool/.env");
    process.exit(1);
  }
  if (!config.databaseUrl) {
    console.error("DATABASE_URL not set. Add it to pool/.env");
    process.exit(1);
  }

  const cmd = process.argv[2] ?? "list";

  switch (cmd) {
    case "list":
      await cmdList();
      break;
    case "pool":
      await cmdPool();
      break;
    case "provision":
      await cmdProvision();
      break;
    case "release":
      const num = process.argv[3];
      if (!num) {
        console.error("Usage: pnpm telnyx:test release <phone_number>");
        process.exit(1);
      }
      await cmdRelease(num);
      break;
    case "seed":
      await cmdSeed();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Available: list, pool, provision, release <number>, seed");
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
