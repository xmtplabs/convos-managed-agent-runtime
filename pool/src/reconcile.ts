import * as db from "./db/pool";
import { fetchBatchStatus } from "./services/status";
import { deriveStatus } from "./status";
import { config } from "./config";
import { sendMetricBatch } from "./metrics";
import type { InstanceRow } from "./types";
import type { BatchStatusResponse } from "./types";

// Health-check a single instance via /pool/health.
export async function healthCheck(url: string) {
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

export interface ReconcileResult {
  updated: Array<{ id: string; from: string; to: string }>;
  checked: number;
  healthSuccess: number;
  healthFailure: number;
  healthTimeout: number;
}

// Shared inner logic: health-check instances, derive status, update DB.
// This is the extracted tick loop body.
async function reconcileInstances(
  dbRows: InstanceRow[],
  agentServices: BatchStatusResponse["services"],
): Promise<ReconcileResult> {
  const dbById = new Map(dbRows.map((r) => [r.id, r]));

  // Only log instances with non-SUCCESS deploy status (errors/anomalies)
  for (const svc of agentServices) {
    if (svc.deployStatus !== "SUCCESS") {
      const row = dbById.get(svc.instanceId);
      console.log(`[reconcile] ${svc.name} deploy=${svc.deployStatus}${row?.claimedAt ? " (claimed)" : ""}`);
    }
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
      if (!result?.ready) console.log(`[reconcile] ${svc.name} health=${JSON.stringify(result)}`);
      return { id: svc.instanceId, result };
    })
  );
  let healthSuccess = 0;
  let healthFailure = 0;
  let healthTimeout = 0;
  for (const c of checks) {
    if (c.status === "fulfilled") {
      healthResults.set(c.value.id, c.value.result);
      if (c.value.result?.ready) healthSuccess++;
      else healthFailure++;
    } else {
      healthTimeout++;
    }
  }

  const updated: ReconcileResult["updated"] = [];

  for (const svc of agentServices) {
    const instId = svc.instanceId;
    const dbRow = dbById.get(instId);

    if (dbRow?.status === "claiming") continue;
    // Skip instances with unknown deploy status to preserve last known state
    if (!svc.deployStatus) continue;

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

    // Never auto-destroy — just update status in DB.
    // Dead/crashed instances must be cleaned up manually via dashboard.
    if (status === "dead" || status === "sleeping") {
      const dbStatus = isClaimed ? "crashed" : "dead";
      if (dbRow?.status === dbStatus && dbRow?.url === url) continue;
      updated.push({ id: instId, from: dbRow?.status || "unknown", to: dbStatus });
      await db.updateStatus(instId, { status: dbStatus, url });
      continue;
    }

    // Skip DB write when nothing changed
    if (dbRow && dbRow.status === status && dbRow.url === url) continue;

    updated.push({ id: instId, from: dbRow?.status || "unknown", to: status });
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

  return { updated, checked: toCheck.length, healthSuccess, healthFailure, healthTimeout };
}

// Send metrics after reconciliation
async function sendReconcileMetrics(result: ReconcileResult, durationMs: number) {
  const counts = await db.getCounts();
  const total = (counts.starting || 0) + (counts.idle || 0) + (counts.claimed || 0);

  console.log(
    `[reconcile] ${counts.idle || 0} idle, ${counts.starting || 0} starting, ${counts.claimed || 0} claimed, ${counts.crashed || 0} crashed (total: ${total})`
  );

  sendMetricBatch("reconcile", [
    ["pool.idle", counts.idle || 0],
    ["pool.starting", counts.starting || 0],
    ["pool.claimed", counts.claimed || 0],
    ["pool.crashed", counts.crashed || 0],
    ["pool.dead", counts.dead || 0],
    ["pool.total", total],
    ["health_check.success", result.healthSuccess],
    ["health_check.failure", result.healthFailure],
    ["health_check.timeout", result.healthTimeout],
    ["reconcile.duration_ms", durationMs],
  ]);
}

// Reconcile all instances — full sweep.
export async function reconcileAll(): Promise<ReconcileResult> {
  const start = Date.now();

  let batchResult: BatchStatusResponse;
  try {
    batchResult = await fetchBatchStatus();
  } catch (err: any) {
    console.warn(`[reconcile] fetchBatchStatus failed: ${err.message}`);
    return { updated: [], checked: 0, healthSuccess: 0, healthFailure: 0, healthTimeout: 0 };
  }

  const dbRows = await db.listAll();
  const result = await reconcileInstances(dbRows, batchResult.services || []);
  await sendReconcileMetrics(result, Date.now() - start);
  return result;
}

// Reconcile only instances with a specific status.
export async function reconcileByStatus(status: string): Promise<ReconcileResult> {
  const start = Date.now();

  const dbRows = await db.getByStatus(status as any);
  if (dbRows.length === 0) {
    return { updated: [], checked: 0, healthSuccess: 0, healthFailure: 0, healthTimeout: 0 };
  }

  const ids = dbRows.map((r) => r.id);

  let batchResult: BatchStatusResponse;
  try {
    batchResult = await fetchBatchStatus(ids);
  } catch (err: any) {
    console.warn(`[reconcile] fetchBatchStatus failed for status=${status}: ${err.message}`);
    return { updated: [], checked: 0, healthSuccess: 0, healthFailure: 0, healthTimeout: 0 };
  }

  const result = await reconcileInstances(dbRows, batchResult.services || []);
  await sendReconcileMetrics(result, Date.now() - start);
  return result;
}

// Reconcile a single instance by ID.
export async function reconcileInstance(id: string): Promise<ReconcileResult> {
  const start = Date.now();

  const row = await db.findById(id);
  if (!row) {
    console.warn(`[reconcile] Instance ${id} not found in DB`);
    return { updated: [], checked: 0, healthSuccess: 0, healthFailure: 0, healthTimeout: 0 };
  }

  let batchResult: BatchStatusResponse;
  try {
    batchResult = await fetchBatchStatus([id]);
  } catch (err: any) {
    console.warn(`[reconcile] fetchBatchStatus failed for ${id}: ${err.message}`);
    return { updated: [], checked: 0, healthSuccess: 0, healthFailure: 0, healthTimeout: 0 };
  }

  const result = await reconcileInstances([row], batchResult.services || []);
  await sendReconcileMetrics(result, Date.now() - start);
  return result;
}
