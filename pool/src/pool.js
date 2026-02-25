import { nanoid } from "nanoid";
import * as db from "./db/pool.js";
import * as railway from "./railway.js";
import { deriveStatus } from "./status.js";
import { ensureVolume, fetchAllVolumesByService } from "./volumes.js";
import { instanceEnvVars, resolveOpenRouterApiKey, resolveAgentMailInbox, generatePrivateWalletKey, generateGatewayToken, generateSetupPassword } from "./keys.js";
import { destroyInstance, destroyInstances } from "./delete.js";

const POOL_API_KEY = process.env.POOL_API_KEY;
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

// Create a single new Railway service and insert into DB.
export async function createInstance() {
  const id = nanoid(12);
  const name = `convos-agent-${id}`;

  console.log(`[pool] Creating instance ${name}...`);

  const vars = { ...instanceEnvVars() };
  vars.OPENCLAW_GATEWAY_TOKEN = generateGatewayToken();
  vars.SETUP_PASSWORD = generateSetupPassword();
  vars.PRIVATE_WALLET_KEY = generatePrivateWalletKey();
  const { key: openRouterKey, hash: openRouterKeyHash } = await resolveOpenRouterApiKey(id);
  if (openRouterKey) vars.OPENROUTER_API_KEY = openRouterKey;
  const { inboxId: agentMailInboxId } = await resolveAgentMailInbox(id);
  if (agentMailInboxId) vars.AGENTMAIL_INBOX_ID = agentMailInboxId;

  const serviceId = await railway.createService(name, vars);
  console.log(`[pool]   Railway service created: ${serviceId}`);

  // Attach persistent volume for OpenClaw state
  const hasVolume = await ensureVolume(serviceId);
  if (!hasVolume) console.warn(`[pool]   Volume creation failed for ${serviceId}, will retry in tick`);

  let url = null;
  try {
    const domain = await railway.createDomain(serviceId);
    url = `https://${domain}`;
    console.log(`[pool]   Domain: ${url}`);
  } catch (err) {
    console.warn(`[pool]   Domain creation failed for ${serviceId}, will retry in tick: ${err.message}`);
  }

  // Insert into DB as starting
  await db.upsertInstance({
    id,
    serviceId,
    name,
    url,
    status: "starting",
    deployStatus: "BUILDING",
    createdAt: new Date().toISOString(),
    openrouterKeyHash: openRouterKeyHash || null,
    agentmailInboxId: agentMailInboxId || null,
    gatewayToken: vars.OPENCLAW_GATEWAY_TOKEN,
  });

  return { id, serviceId, url, name };
}

// Unified tick: rebuild instance state from Railway, health-check, replenish.
export async function tick() {
  const myEnvId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!myEnvId) {
    console.warn(`[tick] RAILWAY_ENVIRONMENT_ID not set, skipping tick`);
    return;
  }

  const allServices = await railway.listProjectServices();

  if (allServices === null) {
    console.warn(`[tick] listProjectServices failed, skipping tick`);
    return;
  }

  // Filter to agent services in our environment
  const agentServices = allServices.filter(
    (s) =>
      s.name.startsWith("convos-agent-") &&
      s.name !== "convos-agent-pool-manager" &&
      s.environmentIds.includes(myEnvId)
  );

  // Load all DB rows for reconciliation
  const dbRows = await db.listAll();
  const dbByServiceId = new Map(dbRows.map((r) => [r.service_id, r]));

  // Log deploy statuses for agent services
  for (const svc of agentServices) {
    const row = dbByServiceId.get(svc.id);
    console.log(`[tick] ${svc.name} deploy=${svc.deployStatus}${row?.claimed_at ? " (claimed)" : ""}`);
  }

  // Health-check all SUCCESS services in parallel
  const successServices = agentServices.filter((s) => s.deployStatus === "SUCCESS");

  // Get URLs for services — prefer DB url, then batched domain from listProjectServices
  const urlMap = new Map();
  for (const svc of successServices) {
    const row = dbByServiceId.get(svc.id);
    if (row?.url) {
      urlMap.set(svc.id, row.url);
    } else if (svc.domain) {
      urlMap.set(svc.id, `https://${svc.domain}`);
    }
  }

  // For services still without a domain, try creating one
  const needDomains = successServices.filter((s) => !urlMap.has(s.id));
  if (needDomains.length > 0) {
    const domainResults = await Promise.allSettled(
      needDomains.map(async (svc) => {
        try {
          const domain = await railway.createDomain(svc.id);
          if (domain) {
            const url = `https://${domain}`;
            console.log(`[tick] Created missing domain for ${svc.name}: ${url}`);
            return { id: svc.id, url };
          }
        } catch (err) {
          console.warn(`[tick] Failed to create domain for ${svc.name}: ${err.message}`);
        }
        return { id: svc.id, url: null };
      })
    );
    for (const r of domainResults) {
      if (r.status === "fulfilled" && r.value.url) {
        urlMap.set(r.value.id, r.value.url);
      }
    }
  }

  // Health-check SUCCESS services in parallel (skip instances being claimed)
  const healthResults = new Map();
  const toCheck = successServices.filter((s) => {
    const row = dbByServiceId.get(s.id);
    return urlMap.has(s.id) && row?.status !== "claiming";
  });

  const checks = await Promise.allSettled(
    toCheck.map(async (svc) => {
      const result = await healthCheck(urlMap.get(svc.id));
      if (!result?.ready) console.log(`[tick] ${svc.name} health=${JSON.stringify(result)}`);
      return { id: svc.id, result };
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
    const dbRow = dbByServiceId.get(svc.id);

    // Skip services being claimed right now
    if (dbRow?.status === "claiming") continue;

    const hc = healthResults.get(svc.id) || null;
    const isClaimed = !!dbRow?.agent_name;
    const status = deriveStatus({
      deployStatus: svc.deployStatus,
      healthCheck: hc,
      createdAt: svc.createdAt,
      isClaimed,
    });
    const url = urlMap.get(svc.id) || dbRow?.url || null;

    if (status === "dead" || status === "sleeping") {
      if (isClaimed) {
        // Was claimed — mark as crashed in DB
        await db.updateStatus(svc.id, { status: "crashed", deployStatus: svc.deployStatus, url });
      } else {
        // Was idle/starting — delete silently
        toDelete.push({ svc, dbRow });
        await db.deleteByServiceId(svc.id);
      }
      continue;
    }

    // Upsert into DB — preserve existing metadata fields via COALESCE
    const instId = dbRow?.id || svc.name.replace("convos-agent-", "");
    await db.upsertInstance({
      id: instId,
      serviceId: svc.id,
      name: svc.name,
      url,
      status,
      deployStatus: svc.deployStatus,
      createdAt: svc.createdAt,
      // Metadata fields: pass null to preserve existing via COALESCE
      agentName: dbRow?.agent_name || null,
      conversationId: dbRow?.conversation_id || null,
      inviteUrl: dbRow?.invite_url || null,
      instructions: dbRow?.instructions || null,
      claimedAt: dbRow?.claimed_at || null,
      sourceBranch: dbRow?.source_branch || null,
    });
  }

  // Remove DB rows for services no longer in Railway (skip starting/claiming)
  const railwayServiceIds = agentServices.map((s) => s.id);
  await db.deleteOrphaned(railwayServiceIds).catch((err) =>
    console.warn(`[tick] deleteOrphaned failed: ${err.message}`)
  );

  // Delete dead services + their volumes (single volume query for all)
  await destroyInstances(toDelete);

  // Ensure all agent services have volumes (parallel)
  const volumeMap = await fetchAllVolumesByService();
  if (volumeMap) {
    const missing = agentServices.filter(
      (s) => !volumeMap.has(s.id) && s.deployStatus === "SUCCESS"
    );
    if (missing.length > 0) {
      const settled = await Promise.allSettled(missing.map((s) => ensureVolume(s.id)));
      settled.forEach((r, i) => {
        if (r.status === "rejected" || r.value === false) {
          console.warn(`[tick] Agent ${missing[i].name} volume create failed`);
        }
      });
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
  const volumeMap = await fetchAllVolumesByService();
  console.log(`[pool] Triggered delete for ${toDrain.length} instance(s): ${ids.join(", ")}`);

  // Re-check status from DB before destroying (may have been claimed during volume fetch)
  const settled = await Promise.allSettled(
    toDrain.map(async (inst) => {
      const current = await db.findByServiceId(inst.service_id);
      if (!current || CLAIMED_STATUSES.has(current.status)) {
        console.log(`[pool]   Skipping ${inst.id} (no longer unclaimed)`);
        return { skipped: true };
      }
      return destroyInstance(inst, volumeMap);
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
  if (!inst) return; // Already gone (e.g. duplicate kill request)

  console.log(`[pool] Killing instance ${inst.id} (${inst.agent_name || inst.name})`);
  await destroyInstance(inst);
}

// Dismiss a crashed agent (user-initiated from dashboard).
export async function dismissCrashed(id) {
  const inst = await db.findById(id);
  if (!inst || inst.status !== "crashed") throw new Error(`Crashed instance ${id} not found`);

  console.log(`[pool] Dismissing crashed ${inst.id} (${inst.agent_name || inst.name})`);
  await destroyInstance(inst);
}
