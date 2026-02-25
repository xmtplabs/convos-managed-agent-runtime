/**
 * Standalone script to enrich existing `instances` rows with data from Railway API.
 *
 * NOTE: This script now uses the services API via services-client instead of
 * talking to Railway directly (railway.js was removed in Phase 3 extraction).
 *
 * Usage:
 *   node --env-file=.env src/db/enrich-instances.js            # enrich rows missing any field
 *   node --env-file=.env src/db/enrich-instances.js --all      # re-fetch all rows
 *   node --env-file=.env src/db/enrich-instances.js --dry-run  # preview without writing
 */

import { sql, pool as pgPool } from "./connection.js";
import * as servicesClient from "../services-client.js";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const ALL = args.has("--all");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing env var: DATABASE_URL");
    process.exit(1);
  }
  if (!process.env.SERVICES_URL) {
    console.error("Missing env var: SERVICES_URL");
    process.exit(1);
  }

  if (DRY_RUN) console.log("(dry-run mode — no writes)\n");

  // 1. Fetch all services via batch status
  console.log("Fetching service status...");
  const batchResult = await servicesClient.fetchBatchStatus();
  const services = batchResult.services || [];
  const serviceMap = new Map(services.map((s) => [s.serviceId, s]));
  console.log(`  Found ${services.length} total services\n`);

  // 2. Load instances to enrich
  const rows = ALL
    ? await sql`SELECT * FROM instances ORDER BY created_at`
    : await sql`
        SELECT * FROM instances
        WHERE url IS NULL OR deploy_status IS NULL OR gateway_token IS NULL
           OR agentmail_inbox_id IS NULL OR runtime_image IS NULL
           OR (openrouter_key_hash IS NULL AND status = 'claimed')
           OR (claimed_at IS NULL AND status = 'claimed')
        ORDER BY created_at`;

  if (rows.rows.length === 0) {
    console.log("All instances already have complete data. Nothing to do.");
    console.log("  (use --all to re-fetch everything)");
    pgPool.end();
    return;
  }

  console.log(`Enriching ${rows.rows.length} instance(s)...\n`);

  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows.rows) {
    const label = `${row.id} (${row.agent_name || row.name || "unclaimed"})`;
    const svc = serviceMap.get(row.service_id);

    if (!svc) {
      console.log(`  SKIP ${label} — service ${row.service_id} not found`);
      skipped++;
      continue;
    }

    try {
      const domain = svc.domain || null;
      const runtimeImage = svc.image || null;
      const url = domain ? `https://${domain}` : null;
      const deployStatus = svc.deployStatus || null;
      const name = svc.name || null;

      // For claimed instances with no claimed_at, default to created_at
      const claimedAt = (!row.claimed_at && row.status === "claimed") ? row.created_at : null;

      // Detect changes
      const changes = [];
      if (url && url !== row.url) changes.push(`url=${domain}`);
      if (deployStatus && deployStatus !== row.deploy_status) changes.push(`deploy=${deployStatus}`);
      if (name && name !== row.name) changes.push(`name=${name}`);
      if (runtimeImage && runtimeImage !== row.runtime_image) changes.push(`image=${runtimeImage}`);
      if (claimedAt) changes.push(`claimed_at=${claimedAt.toISOString?.() || claimedAt}`);

      if (changes.length === 0) {
        console.log(`  SKIP ${label} — already up to date`);
        skipped++;
        continue;
      }

      console.log(`  ${DRY_RUN ? "WOULD UPDATE" : "UPDATE"} ${label}: ${changes.join(", ")}`);

      if (!DRY_RUN) {
        await sql`
          UPDATE instances SET
            url = COALESCE(${url}, url),
            deploy_status = COALESCE(${deployStatus}, deploy_status),
            name = COALESCE(${name}, name),
            runtime_image = COALESCE(${runtimeImage}, runtime_image),
            claimed_at = COALESCE(${claimedAt}, claimed_at)
          WHERE service_id = ${row.service_id}
        `;
      }

      enriched++;
    } catch (err) {
      console.error(`  FAIL ${label}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${enriched} enriched, ${skipped} skipped, ${failed} failed`);
  pgPool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
