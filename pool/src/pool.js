import { nanoid } from "nanoid";
import * as db from "./db/pool.js";
import * as servicesClient from "./services-client.js";
import { deriveStatus } from "./status.js";

const POOL_API_KEY = process.env.POOL_API_KEY;

// Destroy via services, treating 404 as success (pre-extraction instances).
async function safeDestroy(instanceId) {
  try {
    await servicesClient.destroyInstance(instanceId);
  } catch (err) {
    if (err.message?.includes("404")) {
      console.warn(`[pool] Instance ${instanceId} not in services DB (pre-extraction), removing from pool DB only`);
      return;
    }
    throw err;
  }
}
const MIN_IDLE = parseInt(process.env.POOL_MIN_IDLE || "3", 10);

// Health-check a single instance via /pool/health.
// Returns parsed JSON on success, null on failure.
async function healthCheck(url) {
  try {
    const res = await fetch(`${url}/pool/health`, {
      headers: { Authorization: `Bearer ${POOL_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log(`[health] ${url} returned ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.log(`[health] ${url} error: ${err.message}`);
    return null;
  }
}

// Create a single new instance via services API and insert into DB.
export async function createInstance() {
  const id = nanoid(12);
  const name = `convos-agent-${id}`;

  console.log(`[pool] Creating instance ${name}...`);

  const result = await servicesClient.createInstance(id, name, ["openrouter", "agentmail"]);
  console.log(`[pool]   Services created: serviceId=${result.serviceId}, url=${result.url}`);

  // Insert into DB as starting
  await db.upsertInstance({
    id,
    serviceId: result.serviceId,
    name,
    url: result.url,
    status: "starting",
    deployStatus: "BUILDING",
    createdAt: new Date().toISOString(),
  });

  return { id, serviceId: result.serviceId, url: result.url, name };
}

// Unified tick: rebuild instance state from services, health-check, replenish.
export async function tick() {
  const myEnvId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!myEnvId) {
    console.warn(`[tick] RAILWAY_ENVIRONMENT_ID not set, skipping tick`);
    return;
  }

  // Fetch status from services API instead of Railway directly
  let batchResult;
  try {
    batchResult = await servicesClient.fetchBatchStatus();
  } catch (err) {
    console.warn(`[tick] fetchBatchStatus failed: ${err.message}`);
    return;
  }

  const agentServices = batchResult.services || [];

  // Load all DB rows for reconciliation
  const dbRows = await db.listAll();
  const dbByServiceId = new Map(dbRows.map((r) => [r.service_id, r]));

  // Log deploy statuses for agent services
  for (const svc of agentServices) {
    const row = dbByServiceId.get(svc.serviceId);
    console.log(`[tick] ${svc.name} deploy=${svc.deployStatus}${row?.claimed_at ? " (claimed)" : ""}`);
  }

  // Health-check all SUCCESS services in parallel
  const successServices = agentServices.filter((s) => s.deployStatus === "SUCCESS");

  // Get URLs for services — prefer DB url, then domain from batch status
  const urlMap = new Map();
  for (const svc of successServices) {
    const row = dbByServiceId.get(svc.serviceId);
    if (row?.url) {
      urlMap.set(svc.serviceId, row.url);
    } else if (svc.domain) {
      urlMap.set(svc.serviceId, `https://${svc.domain}`);
    }
  }

  // Health-check SUCCESS services in parallel (skip instances being claimed)
  const healthResults = new Map();
  const toCheck = successServices.filter((s) => {
    const row = dbByServiceId.get(s.serviceId);
    return urlMap.has(s.serviceId) && row?.status !== "claiming";
  });

  const checks = await Promise.allSettled(
    toCheck.map(async (svc) => {
      const result = await healthCheck(urlMap.get(svc.serviceId));
      if (!result?.ready) console.log(`[tick] ${svc.name} health=${JSON.stringify(result)}`);
      return { id: svc.serviceId, result };
    })
  );
  for (const c of checks) {
    if (c.status === "fulfilled") {
      healthResults.set(c.value.id, c.value.result);
    }
  }

  // Reconcile state and take action on dead/sleeping services
  const toDelete = [];

  for (const svc of agentServices) {
    const dbRow = dbByServiceId.get(svc.serviceId);

    // Skip services being claimed right now
    if (dbRow?.status === "claiming") continue;

    const hc = healthResults.get(svc.serviceId) || null;
    const isClaimed = !!dbRow?.agent_name;
    // Use svc.createdAt if available, otherwise fall back to DB
    const createdAt = dbRow?.created_at || new Date().toISOString();
    const status = deriveStatus({
      deployStatus: svc.deployStatus,
      healthCheck: hc,
      createdAt,
      isClaimed,
    });
    const url = urlMap.get(svc.serviceId) || dbRow?.url || null;

    if (status === "dead" || status === "sleeping") {
      if (isClaimed) {
        // Was claimed — mark as crashed in DB
        await db.updateStatus(svc.serviceId, { status: "crashed", deployStatus: svc.deployStatus, url });
      } else {
        // Was idle/starting — delete silently
        toDelete.push({ svc, dbRow });
        await db.deleteByServiceId(svc.serviceId);
      }
      continue;
    }

    // Upsert into DB — preserve existing metadata fields via COALESCE
    const instId = dbRow?.id || svc.name.replace("convos-agent-", "");
    await db.upsertInstance({
      id: instId,
      serviceId: svc.serviceId,
      name: svc.name,
      url,
      status,
      deployStatus: svc.deployStatus,
      createdAt,
      agentName: dbRow?.agent_name || null,
      conversationId: dbRow?.conversation_id || null,
      inviteUrl: dbRow?.invite_url || null,
      instructions: dbRow?.instructions || null,
      claimedAt: dbRow?.claimed_at || null,
      sourceBranch: dbRow?.source_branch || null,
    });
  }

  // Remove DB rows for services no longer in Railway (skip starting/claiming)
  const railwayServiceIds = agentServices.map((s) => s.serviceId);
  await db.deleteOrphaned(railwayServiceIds).catch((err) =>
    console.warn(`[tick] deleteOrphaned failed: ${err.message}`)
  );

  // Delete dead services via services API
  for (const { svc, dbRow } of toDelete) {
    const instanceId = dbRow?.id || svc.name.replace("convos-agent-", "");
    try {
      await safeDestroy(instanceId);
      console.log(`[tick] Destroyed dead instance ${instanceId}`);
    } catch (err) {
      console.warn(`[tick] Failed to destroy ${instanceId}: ${err.message}`);
    }
  }

  // Replenish
  const counts = await db.getCounts();
  const total = (counts.starting || 0) + (counts.idle || 0) + (counts.claimed || 0);
  const deficit = MIN_IDLE - ((counts.idle || 0) + (counts.starting || 0));

  console.log(
    `[tick] ${counts.idle || 0} idle, ${counts.starting || 0} starting, ${counts.claimed || 0} claimed, ${counts.crashed || 0} crashed (total: ${total})`
  );

  if (deficit > 0) {
    console.log(`[tick] Creating ${deficit} new instance(s)...`);
    const settled = await Promise.allSettled(
      Array.from({ length: deficit }, () => createInstance())
    );
    settled.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[tick] Failed to create instance:`, r.reason);
      }
    });
  }
}

// Provisioning flow lives in provision.js (convos-sdk setup/join orchestration).
export { provision } from "./provision.js";

// Drain unclaimed instances only (idle, starting, dead — never claimed/crashed).
export async function drainPool(count) {
  const CLAIMED_STATUSES = new Set(["claimed", "crashed", "claiming"]);
  const unclaimed = await db.getByStatus(["idle", "starting", "dead"]);
  let toDrain = unclaimed.slice(0, count);
  if (toDrain.length === 0) return [];

  const ids = toDrain.map((i) => i.id);
  console.log(`[pool] Draining ${toDrain.length} unclaimed instance(s): ${ids.join(", ")}`);

  // Re-check status from DB before destroying (may have been claimed)
  const settled = await Promise.allSettled(
    toDrain.map(async (inst) => {
      const current = await db.findByServiceId(inst.service_id);
      if (!current || CLAIMED_STATUSES.has(current.status)) {
        console.log(`[pool]   Skipping ${inst.id} (no longer unclaimed)`);
        return { skipped: true };
      }
      await safeDestroy(inst.id);
      await db.deleteByServiceId(inst.service_id).catch(() => {});
      return { skipped: false };
    })
  );

  const results = [];
  let failed = 0;
  let skipped = 0;
  toDrain.forEach((inst, i) => {
    const s = settled[i];
    if (s.status === "fulfilled" && s.value?.skipped) {
      skipped++;
      return;
    }
    if (s.status === "fulfilled") {
      results.push(inst.id);
      console.log(`[pool]   Drained ${inst.id}`);
    } else {
      failed++;
      console.error(`[pool]   Failed to drain ${inst.id}:`, s.reason?.message ?? s.reason);
    }
  });
  if (skipped > 0) console.log(`[pool]   Skipped ${skipped} (no longer unclaimed)`);
  console.log(`[pool] Drain complete: ${results.length} drained, ${failed} failed`);
  return results;
}

// Kill a specific instance.
export async function killInstance(id) {
  const inst = await db.findById(id);
  if (!inst) return; // Already gone

  console.log(`[pool] Killing instance ${inst.id} (${inst.agent_name || inst.name})`);
  await safeDestroy(inst.id);
  await db.deleteByServiceId(inst.service_id).catch(() => {});
}

// Dismiss a crashed agent (user-initiated from dashboard).
export async function dismissCrashed(id) {
  const inst = await db.findById(id);
  if (!inst || inst.status !== "crashed") throw new Error(`Crashed instance ${id} not found`);

  console.log(`[pool] Dismissing crashed ${inst.id} (${inst.agent_name || inst.name})`);
  await safeDestroy(inst.id);
  await db.deleteByServiceId(inst.service_id).catch(() => {});
}
