import { nanoid } from "nanoid";
import * as db from "./db/pool";
import { createInstance as infraCreateInstance, destroyInstance as infraDestroyInstance, type ProgressCallback } from "./services/infra";
import { fetchBatchStatus } from "./services/status";
import { config } from "./config";
import { metricCount, metricHistogram } from "./metrics";
import { logger, classifyError } from "./logger";
import * as railway from "./services/providers/railway";
import * as openrouter from "./services/providers/openrouter";

// Destroy via services. If not in infra DB but we have a Railway serviceId, delete that directly.
async function safeDestroy(instanceId: string, railwayServiceId?: string, projectId?: string) {
  try {
    await infraDestroyInstance(instanceId);
  } catch (err: any) {
    if (err.status === 404 || err.message?.includes("not found")) {
      // Not in infra DB — clean up directly if we can
      if (railwayServiceId) {
        if (projectId) {
          console.log(`[pool] Orphan ${instanceId}: deleting project ${projectId}`);
          await railway.projectDelete(projectId).catch((e: any) =>
            console.warn(`[pool] Failed to delete orphan project ${projectId}: ${e.message}`));
        } else {
          console.log(`[pool] Orphan ${instanceId}: deleting Railway service ${railwayServiceId} directly`);
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

// Create a single new instance via services and insert into DB.
export async function createInstance(onProgress?: ProgressCallback, runtimeImage?: string) {
  const id = nanoid(12);
  const name = `convos-agent-${id}`;
  const createStart = Date.now();

  console.log(`[pool] Creating instance ${name}...`);
  metricCount("instance.create.start");
  logger.info("create.start", { instanceId: id, name });

  try {
    const result = await infraCreateInstance(id, name, ["openrouter", "agentmail", "telnyx"], onProgress, runtimeImage);
    console.log(`[pool]   Services created: serviceId=${result.serviceId}, url=${result.url}`);

    await db.upsertInstance({
      id,
      name,
      url: result.url,
      status: "starting",
      createdAt: new Date().toISOString(),
    });

    return { id, serviceId: result.serviceId, url: result.url, name };
  } catch (err) {
    const { error_class, error_message } = classifyError(err);
    // More specific phase tags are emitted inside infra.createInstance;
    // this is the top-level rollup so dashboards can alert on total create failures.
    metricCount("instance.create.fail", 1, { phase: "unknown", error_class });
    logger.error("create.fail", { instanceId: id, name, error_class, error_message: error_message.slice(0, 1500), duration_ms: Date.now() - createStart });
    throw err;
  }
}

export { provision } from "./provision";

// Health-check a single instance via /pool/health.
export async function healthCheck(url: string) {
  try {
    const res = await fetch(`${url}/pool/health`, {
      headers: { Authorization: `Bearer ${config.poolApiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json() as { ready: boolean; version?: string };
  } catch {
    return null;
  }
}

// Check all starting instances, promote ready ones to idle.
export async function checkStarting() {
  const rows = await db.getByStatus("starting");
  const promoted: string[] = [];
  for (const row of rows) {
    if (!row.url) continue;
    const hc = await healthCheck(row.url);
    if (hc?.ready) {
      await db.updateStatus(row.id, { status: "idle" });
      if (hc.version) await db.setRuntimeVersion(row.id, hc.version);
      promoted.push(row.id);
      const durationMs = Date.now() - new Date(row.createdAt).getTime();
      metricCount("instance.create.complete");
      metricHistogram("instance.create.duration_ms", durationMs);
      logger.info("create.complete", { instanceId: row.id, name: row.name, duration_ms: durationMs, version: hc.version });
      console.log(`[pool] promoted ${row.id} starting → idle (v${hc.version || '?'})`);
    }
  }
  return { checked: rows.length, promoted };
}

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

  const names = toDrain.map((i: any) => i.name || i.id);
  console.log(`[pool] Draining ${toDrain.length} unclaimed instance(s): ${names.join(", ")}`);

  const settled = await Promise.allSettled(
    toDrain.map(async (inst: any) => {
      const label = inst.name || inst.id;
      const current = await db.findById(inst.id);
      if (!current || CLAIMED_STATUSES.has(current.status)) {
        console.log(`[pool]   Skipping ${label} (no longer unclaimed)`);
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
    const label = inst.name || inst.id;
    const s = settled[i];
    if (s.status === "fulfilled" && s.value?.skipped) {
      skipped++;
      return;
    }
    if (s.status === "fulfilled") {
      results.push(inst.id);
      console.log(`[pool]   Drained ${label}`);
    } else {
      failed++;
      console.error(`[pool]   Failed to drain ${label}:`, s.reason?.message ?? s.reason);
    }
  });
  if (skipped > 0) console.log(`[pool]   Skipped ${skipped} (no longer unclaimed)`);
  console.log(`[pool] Drain complete: ${results.length} drained, ${failed} failed`);
  return results;
}

export type DrainProgressCallback = (instanceNum: number, instanceId: string, instanceName: string, step: string, status: string, message?: string) => void;

export async function drainPoolStream(count: number, concurrency: number, onProgress: DrainProgressCallback) {
  const CLAIMED_STATUSES = new Set(["claimed", "crashed", "claiming"]);
  const unclaimed = await db.getByStatus(["idle", "starting", "dead"]);
  const toDrain = unclaimed.slice(0, count);
  if (toDrain.length === 0) return { drained: 0, failed: 0, instances: [] as string[] };

  const names = toDrain.map((i: any) => i.name || i.id);
  console.log(`[pool] Draining (stream) ${toDrain.length} unclaimed instance(s): ${names.join(", ")}`);

  let drained = 0;
  let failed = 0;
  const drainedIds: string[] = [];
  const MAX_CONCURRENCY = concurrency;

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < toDrain.length) {
      const i = nextIndex++;
      const inst = toDrain[i] as any;
      const instanceNum = i + 1;

      const current = await db.findById(inst.id);
      if (!current || CLAIMED_STATUSES.has(current.status)) {
        onProgress(instanceNum, inst.id, inst.name || inst.id, "skip", "skip", "No longer unclaimed");
        continue;
      }

      try {
        await infraDestroyInstance(inst.id, (step, status, message) => {
          onProgress(instanceNum, inst.id, inst.name || inst.id, step, status, message);
        });
        await db.deleteById(inst.id).catch(() => {});
        drainedIds.push(inst.id);
        drained++;
        onProgress(instanceNum, inst.id, inst.name || inst.id, "done", "ok");
      } catch (err: any) {
        failed++;
        onProgress(instanceNum, inst.id, inst.name || inst.id, "error", "fail", err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, toDrain.length) }, () => worker()));

  console.log(`[pool] Drain stream complete: ${drained} drained, ${failed} failed`);
  return { drained, failed, instances: drainedIds };
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

// Health-check a single instance and update its status if it recovered.
export async function recheckInstance(id: string) {
  const inst = await db.findById(id);
  if (!inst) throw new Error(`Instance ${id} not found`);
  if (!inst.url) {
    console.log(`[pool] recheck ${id}: no url, skipping`);
    return { id, status: inst.status, changed: false, reason: "no_url" };
  }

  const hc = await healthCheck(inst.url);
  if (!hc?.ready) {
    console.log(`[pool] recheck ${id}: health check failed (status=${inst.status}, url=${inst.url}, hc=${JSON.stringify(hc)})`);
    return { id, status: inst.status, changed: false, reason: "health_failed", agentName: inst.agentName || null };
  }

  // Ask the runtime for its conversation state
  let runtimeConvoId: string | null = null;
  let statusKnown = false;
  try {
    const csRes = await fetch(`${inst.url}/convos/status`, {
      headers: { Authorization: `Bearer ${config.poolApiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (csRes.ok) {
      const cs = await csRes.json() as { conversation?: { id: string } | null };
      runtimeConvoId = cs.conversation?.id ?? null;
      statusKnown = true;
    }
  } catch {}

  if (!statusKnown) {
    console.log(`[pool] recheck ${id}: /convos/status failed, leaving as ${inst.status}`);
    return { id, status: inst.status, changed: false, reason: "status_unknown", agentName: inst.agentName || null };
  }

  if (runtimeConvoId) {
    // Runtime has a conversation — verify it matches what we provisioned
    if (inst.conversationId && inst.conversationId === runtimeConvoId) {
      await db.updateStatus(id, { status: "claimed" });
      if (hc.version) await db.setRuntimeVersion(id, hc.version);
      console.log(`[pool] recheck ${id}: ${inst.status} → claimed (conversation ${runtimeConvoId} matches DB, v${hc.version || '?'})`);
      return { id, status: "claimed", changed: inst.status !== "claimed", agentName: inst.agentName || null };
    }
    // Runtime has a conversation but DB doesn't match — stuck provision failure
    if (hc.version) await db.setRuntimeVersion(id, hc.version);
    console.log(`[pool] recheck ${id}: runtime has conversation ${runtimeConvoId} but DB has ${inst.conversationId || "none"} — staying ${inst.status}`);
    return { id, status: inst.status, changed: false, reason: "conversation_mismatch", agentName: inst.agentName || null };
  }

  // No active conversation — instance is clean, recover to idle
  await db.recoverToIdle(id, inst.status);
  if (hc.version) await db.setRuntimeVersion(id, hc.version);
  console.log(`[pool] recheck ${id}: ${inst.status} → idle (no conversation, v${hc.version || '?'})`);
  return { id, status: "idle", changed: inst.status !== "idle", agentName: null };
}
