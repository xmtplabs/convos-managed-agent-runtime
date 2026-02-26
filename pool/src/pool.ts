import { nanoid } from "nanoid";
import * as db from "./db/pool";
import { createInstance as infraCreateInstance, destroyInstance as infraDestroyInstance } from "./services/infra";
import { fetchBatchStatus, listSharedProjectServices } from "./services/status";
import { deriveStatus } from "./status";
import { config } from "./config";
import * as railway from "./services/providers/railway";
import * as openrouter from "./services/providers/openrouter";

let tickCount = 0;
const ORPHAN_SCAN_INTERVAL = 10; // Run orphan scan every N ticks

// Destroy via services. If not in infra DB but we have a Railway serviceId, delete that directly.
// For orphans found in the shared project, cleans up service + volumes + OpenRouter key.
async function safeDestroy(instanceId: string, railwayServiceId?: string, projectId?: string) {
  try {
    await infraDestroyInstance(instanceId);
  } catch (err: any) {
    if (err.status === 404 || err.message?.includes("not found")) {
      // Not in infra DB — clean up directly if we can
      if (railwayServiceId) {
        const isOwnProject = projectId && projectId !== config.railwayProjectId;

        if (isOwnProject) {
          // Orphan with own project: delete entire project
          console.log(`[pool] Orphan ${instanceId}: deleting project ${projectId}`);
          await railway.projectDelete(projectId).catch((e: any) =>
            console.warn(`[pool] Failed to delete orphan project ${projectId}: ${e.message}`));
        } else {
          // Orphan in shared project: delete volumes + service
          console.log(`[pool] Orphan ${instanceId}: deleting Railway service ${railwayServiceId} directly`);
          try {
            const volumeMap = await railway.fetchAllVolumesByService();
            for (const volId of volumeMap?.get(railwayServiceId) || []) {
              await railway.deleteVolume(volId, railwayServiceId).catch(() => {});
            }
          } catch {}
          await railway.deleteService(railwayServiceId).catch((e: any) =>
            console.warn(`[pool] Failed to delete orphan service ${railwayServiceId}: ${e.message}`)
          );
        }

        // Best-effort delete the OpenRouter key by name
        const keyHash = await openrouter.findKeyHash(`convos-agent-${instanceId}`);
        if (keyHash) await openrouter.deleteKey(keyHash).catch(() => {});
      } else {
        console.warn(`[pool] Instance ${instanceId} not in infra DB and no serviceId, skipping`);
      }
      return;
    }
    throw err;
  }
}

// Health-check a single instance via /pool/health.
async function healthCheck(url: string) {
  try {
    const res = await fetch(`${url}/pool/health`, {
      headers: { Authorization: `Bearer ${config.poolApiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log(`[health] ${url} returned ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    return await res.json() as { ready: boolean };
  } catch (err: any) {
    console.log(`[health] ${url} error: ${err.message}`);
    return null;
  }
}

// Create a single new instance via services and insert into DB.
export async function createInstance() {
  const id = nanoid(12);
  const name = `convos-agent-${id}`;

  console.log(`[pool] Creating instance ${name}...`);

  const result = await infraCreateInstance(id, name, ["openrouter", "agentmail", "telnyx"]);
  console.log(`[pool]   Services created: serviceId=${result.serviceId}, url=${result.url}`);

  await db.upsertInstance({
    id,
    name,
    url: result.url,
    status: "starting",
    createdAt: new Date().toISOString(),
  });

  return { id, serviceId: result.serviceId, url: result.url, name };
}

// Scan the shared project for orphan services (services with no DB row).
async function scanSharedProjectOrphans() {
  if (!config.railwayProjectId) return;

  console.log(`[tick] Running orphan scan on shared project...`);
  const sharedServices = await listSharedProjectServices();
  if (!sharedServices) return;

  const agents = sharedServices.filter(
    (s) => s.name.startsWith("convos-agent-") && s.name !== "convos-agent-pool-manager",
  );

  const dbRows = await db.listAll();
  const dbIds = new Set(dbRows.map((r: any) => r.id));

  let orphanCount = 0;
  for (const svc of agents) {
    const instId = svc.name.replace("convos-agent-", "");
    if (!dbIds.has(instId)) {
      orphanCount++;
      console.log(`[tick] Orphan in shared project: ${svc.name} (${svc.id})`);
      try {
        await safeDestroy(instId, svc.id);
      } catch (err: any) {
        console.warn(`[tick] Failed to clean orphan ${instId}: ${err.message}`);
      }
    }
  }
  if (orphanCount === 0) console.log(`[tick] No orphans found in shared project`);
}

// Unified tick: rebuild instance state from services, health-check, replenish.
export async function tick() {
  if (!config.railwayEnvironmentId) {
    console.warn(`[tick] RAILWAY_ENVIRONMENT_ID not set, skipping tick`);
    return;
  }

  tickCount++;

  let batchResult;
  try {
    batchResult = await fetchBatchStatus();
  } catch (err: any) {
    console.warn(`[tick] fetchBatchStatus failed: ${err.message}`);
    return;
  }

  const agentServices = batchResult.services || [];

  const dbRows = await db.listAll();
  const dbById = new Map(dbRows.map((r: any) => [r.id, r]));

  const svcByInstanceId = new Map(
    agentServices.map((s) => [s.instanceId, s])
  );

  for (const svc of agentServices) {
    const row = dbById.get(svc.instanceId);
    console.log(`[tick] ${svc.name} deploy=${svc.deployStatus}${row?.claimedAt ? " (claimed)" : ""}`);
  }

  const successServices = agentServices.filter((s) => s.deployStatus === "SUCCESS");

  const urlMap = new Map<string, string>();
  for (const svc of successServices) {
    const row = dbById.get(svc.instanceId);
    if (row?.url) {
      urlMap.set(svc.instanceId, row.url);
    } else if (svc.domain) {
      urlMap.set(svc.instanceId, `https://${svc.domain}`);
    }
  }

  const healthResults = new Map<string, { ready: boolean } | null>();
  const toCheck = successServices.filter((s) => {
    const row = dbById.get(s.instanceId);
    // Skip health checks for already-idle instances — they proved healthy once
    // and Railway may have slept them (waking takes >5s, causing false "dead").
    return urlMap.has(s.instanceId) && row?.status !== "claiming" && row?.status !== "idle";
  });

  const checks = await Promise.allSettled(
    toCheck.map(async (svc) => {
      const result = await healthCheck(urlMap.get(svc.instanceId)!);
      if (!result?.ready) console.log(`[tick] ${svc.name} health=${JSON.stringify(result)}`);
      return { id: svc.instanceId, result };
    })
  );
  for (const c of checks) {
    if (c.status === "fulfilled") {
      healthResults.set(c.value.id, c.value.result);
    }
  }

  const toDelete: Array<{ svc: typeof agentServices[0]; dbRow: any }> = [];

  for (const svc of agentServices) {
    const instId = svc.instanceId;
    const dbRow = dbById.get(instId);

    if (dbRow?.status === "claiming") continue;

    const hc = healthResults.get(instId) || null;
    const isClaimed = !!dbRow?.agentName;
    const createdAt = dbRow?.createdAt || new Date().toISOString();

    // If instance was already idle and deploy is still SUCCESS, trust it —
    // Railway may have slept it, so no health check was performed.
    const wasIdle = dbRow?.status === "idle" && svc.deployStatus === "SUCCESS";

    const status = wasIdle ? "idle" : deriveStatus({
      deployStatus: svc.deployStatus,
      healthCheck: hc,
      createdAt,
      isClaimed,
    });
    const url = urlMap.get(instId) || dbRow?.url || null;

    if (status === "dead" || status === "sleeping") {
      if (isClaimed) {
        await db.updateStatus(instId, { status: "crashed", url });
      } else {
        toDelete.push({ svc, dbRow });
        await db.deleteById(instId);
      }
      continue;
    }

    await db.upsertInstance({
      id: instId,
      name: svc.name,
      url,
      status,
      createdAt,
      agentName: dbRow?.agentName || null,
      conversationId: dbRow?.conversationId || null,
      inviteUrl: dbRow?.inviteUrl || null,
      instructions: dbRow?.instructions || null,
      claimedAt: dbRow?.claimedAt || null,
    });
  }

  // DB-driven: no need for deleteOrphaned based on Railway service list.
  // Instead, periodically scan the shared project for orphans.
  if (tickCount % ORPHAN_SCAN_INTERVAL === 0) {
    try {
      await scanSharedProjectOrphans();
    } catch (err: any) {
      console.warn(`[tick] Orphan scan failed: ${err.message}`);
    }
  }

  for (const { svc, dbRow } of toDelete) {
    const instanceId = dbRow?.id || svc.instanceId;
    try {
      await safeDestroy(instanceId, svc.serviceId);
      await db.deleteById(instanceId).catch(() => {});
      console.log(`[tick] Destroyed dead instance ${instanceId}`);
    } catch (err: any) {
      console.warn(`[tick] Failed to destroy ${instanceId}: ${err.message}`);
    }
  }

  const counts = await db.getCounts();
  const total = (counts.starting || 0) + (counts.idle || 0) + (counts.claimed || 0);
  const deficit = config.poolMinIdle - ((counts.idle || 0) + (counts.starting || 0));

  console.log(
    `[tick] ${counts.idle || 0} idle, ${counts.starting || 0} starting, ${counts.claimed || 0} claimed, ${counts.crashed || 0} crashed (total: ${total})`
  );

  if (deficit > 0) {
    console.log(`[tick] Creating ${deficit} new instance(s)...`);
    const settled = await Promise.allSettled(
      Array.from({ length: deficit }, () => createInstance())
    );
    settled.forEach((r) => {
      if (r.status === "rejected") {
        console.error(`[tick] Failed to create instance:`, r.reason);
      }
    });
  }
}

export { provision } from "./provision";

export async function drainPool(count: number) {
  const CLAIMED_STATUSES = new Set(["claimed", "crashed", "claiming"]);
  const unclaimed = await db.getByStatus(["idle", "starting", "dead"]);
  const toDrain = unclaimed.slice(0, count);
  if (toDrain.length === 0) return [];

  // Fetch Railway serviceIds so safeDestroy can clean up directly
  const svcIdMap = new Map<string, string>();
  try {
    const batch = await fetchBatchStatus(toDrain.map((i: any) => i.id));
    for (const svc of batch.services || []) {
      svcIdMap.set(svc.instanceId, svc.serviceId);
    }
  } catch (err: any) {
    console.warn(`[pool] Failed to fetch serviceIds for drain: ${err.message}`);
  }

  const ids = toDrain.map((i: any) => i.id);
  console.log(`[pool] Draining ${toDrain.length} unclaimed instance(s): ${ids.join(", ")}`);

  const settled = await Promise.allSettled(
    toDrain.map(async (inst: any) => {
      const current = await db.findById(inst.id);
      if (!current || CLAIMED_STATUSES.has(current.status)) {
        console.log(`[pool]   Skipping ${inst.id} (no longer unclaimed)`);
        return { skipped: true };
      }
      await safeDestroy(inst.id, svcIdMap.get(inst.id));
      await db.deleteById(inst.id).catch(() => {});
      return { skipped: false };
    })
  );

  const results: string[] = [];
  let failed = 0;
  let skipped = 0;
  toDrain.forEach((inst: any, i: number) => {
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

export async function killInstance(id: string) {
  const inst = await db.findById(id);
  if (!inst) return;

  // Fetch Railway serviceId so safeDestroy can clean up directly
  let railwayServiceId: string | undefined;
  try {
    const batch = await fetchBatchStatus([id]);
    railwayServiceId = batch.services?.[0]?.serviceId;
  } catch {}

  console.log(`[pool] Killing instance ${inst.id} (${inst.agentName || inst.name})`);
  await safeDestroy(inst.id, railwayServiceId);
  await db.deleteById(inst.id).catch(() => {});
}

export async function dismissCrashed(id: string) {
  const inst = await db.findById(id);
  if (!inst || inst.status !== "crashed") throw new Error(`Crashed instance ${id} not found`);
  if (inst.agentName) throw new Error(`Cannot dismiss claimed agent ${id} (${inst.agentName}) — use kill or redeploy instead`);

  // Fetch Railway serviceId so safeDestroy can clean up directly
  let railwayServiceId: string | undefined;
  try {
    const batch = await fetchBatchStatus([id]);
    railwayServiceId = batch.services?.[0]?.serviceId;
  } catch {}

  console.log(`[pool] Dismissing crashed ${inst.id} (${inst.agentName || inst.name})`);
  await safeDestroy(inst.id, railwayServiceId);
  await db.deleteById(inst.id).catch(() => {});
}
