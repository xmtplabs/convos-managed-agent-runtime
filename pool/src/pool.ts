import { nanoid } from "nanoid";
import * as db from "./db/pool";
import { authFetch } from "./authFetch";
import { config } from "./config";
import { createInstance as infraCreateInstance, destroyInstance as infraDestroyInstance, type ProgressCallback } from "./services/infra";
import { fetchBatchStatus } from "./services/status";
import { metricCount, metricHistogram } from "./metrics";
import { logger, classifyError } from "./logger";
import * as railway from "./services/providers/railway";
import * as openrouter from "./services/providers/openrouter";
import { parseRuntimeStatus, type ParsedRuntimeStatus } from "./runtimeStatus";

function isProtected(id: string): boolean {
  return config.protectedInstances.includes(id);
}

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
export async function createInstance(onProgress?: ProgressCallback, runtimeImage?: string, model?: string) {
  const id = nanoid(12);
  const name = `convos-agent-${id}`;
  const createStart = Date.now();

  console.log(`[pool] Creating instance ${name}...`);
  metricCount("instance.create.start");
  logger.info("create.start", { instanceId: id, name });

  try {
    const result = await infraCreateInstance(id, name, ["openrouter"], onProgress, runtimeImage, model);
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
export async function healthCheck(url: string, gatewayToken?: string | null) {
  try {
    const res = await authFetch(`${url}/pool/health`, {
      gatewayToken,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json() as { ready: boolean; version?: string; runtime?: string };
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
    const token = await db.getGatewayToken(row.id);
    const hc = await healthCheck(row.url, token);
    if (hc?.ready) {
      await db.updateStatus(row.id, { status: "idle" });
      if (hc.version) await db.setRuntimeVersion(row.id, hc.version, hc.runtime);
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
  const CLAIMED_STATUSES = new Set(["claimed", "pending_acceptance", "tainted", "crashed", "claiming"]);
  const unclaimed = (await db.getByStatus(["idle", "starting", "dead"]))
    .filter((i: any) => !isProtected(i.id));
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
  const CLAIMED_STATUSES = new Set(["claimed", "pending_acceptance", "tainted", "crashed", "claiming"]);
  const unclaimed = (await db.getByStatus(["idle", "starting", "dead"]))
    .filter((i: any) => !isProtected(i.id));
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
  if (isProtected(id)) throw new Error(`Instance ${id} is protected and cannot be killed`);
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

  const instToken = await db.getGatewayToken(id);
  const hc = await healthCheck(inst.url, instToken);
  if (!hc?.ready) {
    console.log(`[pool] recheck ${id}: health check failed (status=${inst.status}, url=${inst.url}, hc=${JSON.stringify(hc)})`);
    return { id, status: inst.status, changed: false, reason: "health_failed", agentName: inst.agentName || null };
  }

  // Ask the runtime for its status
  let rs: ParsedRuntimeStatus | null = null;
  try {
    const csRes = await authFetch(`${inst.url}/convos/status`, {
      gatewayToken: instToken,
      signal: AbortSignal.timeout(5000),
    });
    if (csRes.ok) rs = parseRuntimeStatus(await csRes.json());
  } catch {}

  if (!rs) {
    console.log(`[pool] recheck ${id}: /convos/status failed, leaving as ${inst.status}`);
    return { id, status: inst.status, changed: false, reason: "status_unknown", agentName: inst.agentName || null };
  }

  if (rs.conversationId) {
    // pending_acceptance with conversation → promote to claimed
    if (inst.status === "pending_acceptance") {
      const updated = await db.completePendingAcceptance(id, rs.conversationId);
      if (hc.version) await db.setRuntimeVersion(id, hc.version, hc.runtime);
      if (!updated) {
        console.log(`[pool] recheck ${id}: pending_acceptance promotion skipped (status changed)`);
        return { id, status: inst.status, changed: false, reason: "promotion_skipped", agentName: inst.agentName || null };
      }
      console.log(`[pool] recheck ${id}: pending_acceptance → claimed (conversation ${rs.conversationId}, v${hc.version || "?"})`);
      return { id, status: "claimed", changed: true, agentName: inst.agentName || null };
    }
    // Conversation matches DB → claimed
    if (inst.conversationId && inst.conversationId === rs.conversationId) {
      await db.updateStatus(id, { status: "claimed" });
      if (hc.version) await db.setRuntimeVersion(id, hc.version, hc.runtime);
      console.log(`[pool] recheck ${id}: ${inst.status} → claimed (conversation ${rs.conversationId} matches DB, v${hc.version || "?"})`);
      return { id, status: "claimed", changed: inst.status !== "claimed", agentName: inst.agentName || null };
    }
    // Conversation mismatch → tainted
    const taintUpdated = await db.conditionalUpdateStatus(id, "tainted", inst.status);
    if (hc.version) await db.setRuntimeVersion(id, hc.version, hc.runtime);
    if (!taintUpdated) {
      console.log(`[pool] recheck ${id}: conversation mismatch taint skipped (status changed)`);
      return { id, status: inst.status, changed: false, reason: "taint_skipped", agentName: inst.agentName || null };
    }
    console.log(`[pool] recheck ${id}: runtime has conversation ${rs.conversationId} but DB has ${inst.conversationId || "none"} — marking tainted`);
    return { id, status: "tainted", changed: inst.status !== "tainted", reason: "conversation_mismatch", agentName: inst.agentName || null };
  }

  // pending_acceptance still in flight on runtime
  if (rs.pending && inst.status === "pending_acceptance") {
    if (hc.version) await db.setRuntimeVersion(id, hc.version, hc.runtime);
    console.log(`[pool] recheck ${id}: pending acceptance still active`);
    return { id, status: inst.status, changed: false, reason: "pending_acceptance", agentName: inst.agentName || null };
  }

  // Runtime is clean → recover to idle
  if (rs.clean === true) {
    await db.recoverToIdle(id, inst.status);
    if (hc.version) await db.setRuntimeVersion(id, hc.version, hc.runtime);
    console.log(`[pool] recheck ${id}: ${inst.status} → idle (runtime clean, v${hc.version || "?"})`);
    return { id, status: "idle", changed: inst.status !== "idle", agentName: null };
  }

  // pending_acceptance but runtime no longer pending → tainted
  if (inst.status === "pending_acceptance" && !rs.pending) {
    const updated = await db.failPendingAcceptance(id);
    if (hc.version) await db.setRuntimeVersion(id, hc.version, hc.runtime);
    if (!updated) {
      console.log(`[pool] recheck ${id}: pending_acceptance taint skipped (status changed)`);
      return { id, status: inst.status, changed: false, reason: "taint_skipped", agentName: inst.agentName || null };
    }
    console.log(`[pool] recheck ${id}: pending_acceptance → tainted (runtime no longer pending)`);
    return { id, status: "tainted", changed: true, reason: "pending_failed", agentName: inst.agentName || null };
  }

  // Runtime not clean, no conversation — leave as-is
  if (hc.version) await db.setRuntimeVersion(id, hc.version, hc.runtime);
  console.log(`[pool] recheck ${id}: runtime not clean (clean=${rs.clean} pending=${rs.pending}) — staying ${inst.status}`);
  return { id, status: inst.status, changed: false, reason: "runtime_not_clean", agentName: inst.agentName || null };
}
