/**
 * SMS pool audit — find phones that are assigned but have no live instance,
 * and can be freed back to the available pool.
 *
 * Source of truth for phone→instance mapping is `instance_services` (tool_id='telnyx').
 * The `phone_number_pool` table only tracks available/assigned status.
 *
 * Usage:  pnpm sms:audit          (dry-run)
 *         pnpm sms:audit --fix    (free orphaned phones)
 */

import { sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { phoneNumberPool, instances, instanceServices } from "../src/db/schema";
import { config } from "../src/config";

function getDb() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 });
  return { db: drizzle(pool, { schema: { phoneNumberPool, instances, instanceServices } }), pool };
}

async function main() {
  if (!config.databaseUrl) {
    console.error("DATABASE_URL not set. Add it to pool/.env");
    process.exit(1);
  }

  const { db, pool } = getDb();

  try {
    // 1. Phone pool summary
    const phoneRows = await db.select().from(phoneNumberPool);
    const assigned = phoneRows.filter((r) => r.status === "assigned");
    const available = phoneRows.filter((r) => r.status === "available");

    console.log("\n=== Phone Number Pool ===\n");
    console.log(`  Total phones:  ${phoneRows.length}`);
    console.log(`  Assigned:      ${assigned.length}`);
    console.log(`  Available:     ${available.length}`);

    // 2. Instance summary
    const instanceRows = await db.select({
      id: instances.id,
      status: instances.status,
      name: instances.name,
    }).from(instances);

    const statusCounts: Record<string, number> = {};
    for (const inst of instanceRows) {
      statusCounts[inst.status] = (statusCounts[inst.status] ?? 0) + 1;
    }

    console.log("\n=== Instances ===\n");
    for (const [status, count] of Object.entries(statusCounts).sort()) {
      console.log(`  ${status}: ${count}`);
    }
    console.log(`  Total: ${instanceRows.length}`);

    // 3. Telnyx service bindings (source of truth for phone→instance)
    const telnyxServices = await db.select({
      instanceId: instanceServices.instanceId,
      resourceId: instanceServices.resourceId,
    }).from(instanceServices).where(sql`${instanceServices.toolId} = 'telnyx'`);

    console.log(`\n=== Telnyx Service Bindings ===\n`);
    console.log(`  Instances with telnyx service: ${telnyxServices.length}`);

    // 4. Build lookup maps
    const instanceMap = new Map(instanceRows.map((i) => [i.id, i]));
    const serviceByPhone = new Map(telnyxServices.map((s) => [s.resourceId, s.instanceId]));
    const phoneSet = new Set(phoneRows.map((r) => r.phoneNumber));

    // 5. Find assigned phones whose instance is dead/missing (via instance_services)
    const ALIVE_STATUSES = new Set(["starting", "idle", "claiming", "claimed", "pending_acceptance", "sleeping"]);

    console.log("\n=== Audit: Phones That Should Be Freed ===\n");

    const toFree: Array<{ phone: string; instanceId: string | null; reason: string }> = [];

    for (const phone of assigned) {
      const instanceId = serviceByPhone.get(phone.phoneNumber);
      if (!instanceId) {
        toFree.push({ phone: phone.phoneNumber, instanceId: null, reason: "assigned but no telnyx service binding" });
        continue;
      }

      const inst = instanceMap.get(instanceId);
      if (!inst) {
        toFree.push({ phone: phone.phoneNumber, instanceId, reason: "instance not found in DB" });
        continue;
      }

      if (!ALIVE_STATUSES.has(inst.status)) {
        toFree.push({ phone: phone.phoneNumber, instanceId, reason: `instance status is '${inst.status}'` });
        continue;
      }
    }

    if (toFree.length === 0) {
      console.log("  All assigned phones are linked to alive instances. Nothing to free.");
    } else {
      for (const entry of toFree) {
        console.log(`  ${entry.phone}  instance=${entry.instanceId ?? "(none)"}  — ${entry.reason}`);
      }
      console.log(`\n  Total to free: ${toFree.length}`);
      console.log(`  After cleanup: ${available.length + toFree.length} available, ${assigned.length - toFree.length} assigned`);
    }

    // 6. Orphaned service bindings (telnyx service exists but phone not in pool)
    console.log("\n=== Orphaned Service Bindings ===\n");
    const orphanedBindings = telnyxServices.filter((s) => !phoneSet.has(s.resourceId));
    if (orphanedBindings.length === 0) {
      console.log("  None — all telnyx service bindings have a matching pool entry.");
    } else {
      for (const s of orphanedBindings) {
        const inst = instanceMap.get(s.instanceId);
        console.log(`  ${s.resourceId}  instance=${s.instanceId} (${inst?.status ?? "missing"})  — phone not in pool table`);
      }
    }

    // 7. Assigned phones with no service binding
    console.log("\n=== Assigned Phones Without Service Binding ===\n");
    const noBinding = assigned.filter((p) => !serviceByPhone.has(p.phoneNumber));
    if (noBinding.length === 0) {
      console.log("  None — all assigned phones have a telnyx service binding.");
    } else {
      for (const p of noBinding) {
        console.log(`  ${p.phoneNumber}  — no instance_services row`);
      }
    }

    // 8. Apply fix if --fix flag is passed
    const fix = process.argv.includes("--fix");

    if (toFree.length > 0 && fix) {
      console.log("\n=== FIXING: Freeing phones ===\n");
      const phonesToFree = toFree.map((e) => e.phone);
      const result = await db
        .update(phoneNumberPool)
        .set({ status: "available" })
        .where(inArray(phoneNumberPool.phoneNumber, phonesToFree));
      console.log(`  Updated ${result.rowCount} phone(s) → available`);
    } else if (toFree.length > 0) {
      console.log("\n=== DRY RUN — run with --fix to apply changes ===\n");
    } else {
      console.log("");
    }

  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
