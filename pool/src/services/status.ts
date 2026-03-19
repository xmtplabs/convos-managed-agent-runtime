import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { instances, instanceInfra } from "../db/schema";
import type { BatchStatusResponse } from "../types";

/**
 * Fetch batch status for all agent services from the DB.
 * Status is kept up-to-date by Railway webhooks — no live API calls needed.
 */
export async function fetchBatchStatus(instanceIds?: string[]): Promise<BatchStatusResponse> {
  let rows = await db
    .select({
      instanceId: instanceInfra.instanceId,
      providerServiceId: instanceInfra.providerServiceId,
      providerEnvId: instanceInfra.providerEnvId,
      url: instanceInfra.url,
      deployStatus: instanceInfra.deployStatus,
      runtimeImage: instanceInfra.runtimeImage,
      name: instances.name,
    })
    .from(instanceInfra)
    .leftJoin(instances, eq(instanceInfra.instanceId, instances.id));

  if (instanceIds && instanceIds.length > 0) {
    const idSet = new Set(instanceIds);
    rows = rows.filter((r) => idSet.has(r.instanceId));
  }

  const results: BatchStatusResponse["services"] = rows.map((row) => ({
    instanceId: row.instanceId,
    serviceId: row.providerServiceId,
    name: row.name || row.instanceId,
    deployStatus: row.deployStatus || null,
    domain: row.url ? row.url.replace("https://", "") : null,
    image: row.runtimeImage || null,
    environmentIds: row.providerEnvId ? [row.providerEnvId] : [],
  }));

  return { services: results };
}
