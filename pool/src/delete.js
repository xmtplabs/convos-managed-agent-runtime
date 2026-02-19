/**
 * Instance deletion: OpenRouter key cleanup, Railway service + volume teardown,
 * cache removal, and DB row deletion.
 *
 * destroyInstance()  — single instance (kill, drain, dismiss)
 * destroyInstances() — batch delete (tick), fetches all volumes once
 */

import * as db from "./db/pool.js";
import * as railway from "./railway.js";
import * as cache from "./cache.js";
import { deleteOpenRouterKey } from "./keys.js";
import { fetchAllVolumesByService, deleteVolume } from "./volumes.js";

// Services that failed to delete — skip on future ticks to avoid retry loops.
const deleteFailures = new Set();

async function cleanupVolumes(serviceId, volumeMap) {
  const volumeIds = volumeMap?.get(serviceId) || [];
  for (const id of volumeIds) {
    await deleteVolume(id, serviceId);
  }
}

/** Delete a single instance (kill, drain, dismiss).
 *  Retries service deletion up to 3 times. Only removes from cache/DB after
 *  Railway confirms the service is deleted. Throws if deletion fails.
 *  Optional volumeMap: when provided (e.g. from drainPool batch), skips fetch. */
export async function destroyInstance(inst, volumeMap = null) {
  console.log(`[delete] Deleting instance ${inst.id} (serviceId=${inst.serviceId})`);
  await deleteOpenRouterKey(inst.openRouterKeyHash);
  const map = volumeMap ?? (await fetchAllVolumesByService());
  await cleanupVolumes(inst.serviceId, map);
  console.log(`[delete] Volumes cleaned for ${inst.id}, deleting Railway service...`);

  // Retry service deletion with backoff
  let deleted = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await railway.deleteService(inst.serviceId);
      deleted = true;
      break;
    } catch (err) {
      console.warn(`[delete] Failed to delete service ${inst.serviceId} (attempt ${attempt}/3): ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  if (!deleted) {
    throw new Error(`Failed to delete Railway service ${inst.serviceId} after 3 attempts`);
  }

  console.log(`[delete] Railway service deleted for ${inst.id}, removing from cache/DB`);
  cache.remove(inst.serviceId);
  await db.deleteByServiceId(inst.serviceId).catch(() => {});
}

/** Batch-delete instances (tick). Fetches all volumes once, then deletes each. */
export async function destroyInstances(items) {
  if (items.length === 0) return;

  const volumeMap = await fetchAllVolumesByService();

  for (const { svc, cached } of items) {
    if (deleteFailures.has(svc.id)) continue;
    try {
      await deleteOpenRouterKey(cached?.openRouterKeyHash);
      await cleanupVolumes(svc.id, volumeMap);
      await railway.deleteService(svc.id);
      console.log(`[delete] Deleted ${svc.id} (${svc.name})`);
    } catch (err) {
      console.warn(`[delete] Failed to delete ${svc.id}: ${err.message}`);
      deleteFailures.add(svc.id);
    }
  }
}
