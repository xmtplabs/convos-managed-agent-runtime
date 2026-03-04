import { db } from "../db/connection";
import { instanceInfra } from "../db/schema";
import type { BatchStatusResponse } from "../types";

/**
 * Fetch batch status for all agent services from the DB.
 * Status is kept up-to-date by Railway webhooks — no live API calls needed.
 */
export async function fetchBatchStatus(instanceIds?: string[]): Promise<BatchStatusResponse> {
  let infraRows = await db.select().from(instanceInfra);

  if (instanceIds && instanceIds.length > 0) {
    const idSet = new Set(instanceIds);
    infraRows = infraRows.filter((r) => idSet.has(r.instanceId));
  }

  const results: BatchStatusResponse["services"] = infraRows.map((row) => ({
    instanceId: row.instanceId,
    serviceId: row.providerServiceId,
    name: `convos-agent-${row.instanceId}`,
    deployStatus: row.deployStatus || null,
    domain: row.url ? row.url.replace("https://", "") : null,
    image: row.runtimeImage || null,
    environmentIds: row.providerEnvId ? [row.providerEnvId] : [],
  }));

  return { services: results };
}
