/**
 * Standalone script to enrich existing `instances` rows with data from Railway API.
 * Pulls values directly from each instance's Railway env vars.
 *
 * Usage:
 *   node --env-file=.env src/db/enrich-instances.js            # enrich rows missing any field
 *   node --env-file=.env src/db/enrich-instances.js --all      # re-fetch all rows
 *   node --env-file=.env src/db/enrich-instances.js --dry-run  # preview without writing
 */

import { sql, pool as pgPool } from "./connection.js";
import { listProjectServices, getServiceVariables, resolveEnvironmentId } from "../railway.js";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const ALL = args.has("--all");

async function main() {
  for (const key of ["DATABASE_URL", "RAILWAY_API_TOKEN", "RAILWAY_PROJECT_ID"]) {
    if (!process.env[key]) {
      console.error(`Missing env var: ${key}`);
      process.exit(1);
    }
  }

  if (!process.env.RAILWAY_ENVIRONMENT_ID && !process.env.RAILWAY_ENVIRONMENT_NAME) {
    console.error("Missing env var: RAILWAY_ENVIRONMENT_ID or RAILWAY_ENVIRONMENT_NAME");
    process.exit(1);
  }

  await resolveEnvironmentId();

  if (DRY_RUN) console.log("(dry-run mode — no writes)\n");

  // 1. Fetch all Railway services for deploy_status + name
  console.log("Fetching Railway services...");
  const services = await listProjectServices();
  if (!services) {
    console.error("Failed to fetch Railway services");
    process.exit(1);
  }
  const serviceMap = new Map(services.map((s) => [s.id, s]));
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
      console.log(`  SKIP ${label} — service ${row.service_id} not found in Railway`);
      skipped++;
      continue;
    }

    try {
      // Use domain and image from batched listProjectServices() result
      const domain = svc.domain || null;
      const runtimeImage = svc.image || null;
      const url = domain ? `https://${domain}` : null;
      const deployStatus = svc.deployStatus || null;
      const name = svc.name || null;

      // Only fetch env vars if we're missing gateway_token or agentmail_inbox_id
      let gatewayToken = null;
      let agentmailInboxId = null;
      const needVars = ALL || !row.gateway_token || !row.agentmail_inbox_id;
      if (needVars) {
        const vars = await getServiceVariables(row.service_id);
        gatewayToken = vars?.OPENCLAW_GATEWAY_TOKEN || null;
        agentmailInboxId = vars?.AGENTMAIL_INBOX_ID || null;
      }

      // For claimed instances with no claimed_at, default to created_at
      const claimedAt = (!row.claimed_at && row.status === "claimed") ? row.created_at : null;

      // Detect changes
      const changes = [];
      if (url && url !== row.url) changes.push(`url=${domain}`);
      if (deployStatus && deployStatus !== row.deploy_status) changes.push(`deploy=${deployStatus}`);
      if (name && name !== row.name) changes.push(`name=${name}`);
      if (gatewayToken && gatewayToken !== row.gateway_token) changes.push(`token=yes`);
      if (agentmailInboxId && agentmailInboxId !== row.agentmail_inbox_id) changes.push(`agentmail=${agentmailInboxId}`);
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
            gateway_token = COALESCE(${gatewayToken}, gateway_token),
            agentmail_inbox_id = COALESCE(${agentmailInboxId}, agentmail_inbox_id),
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
