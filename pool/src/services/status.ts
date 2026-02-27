import { db } from "../db/connection";
import { instanceInfra } from "../db/schema";
import * as railway from "./providers/railway";
import { sendMetricSilent } from "../metrics";
import type { BatchStatusResponse } from "../types";

const STATUS_CONCURRENCY = 10;

/**
 * Fetch batch status for all agent services.
 * DB-driven: queries instance_infra, then fetches each service's status individually.
 */
export async function fetchBatchStatus(instanceIds?: string[]): Promise<BatchStatusResponse> {
  const batchStart = Date.now();

  // Get all infra rows from DB
  let infraRows = await db.select().from(instanceInfra);

  // Filter to requested instanceIds if provided
  if (instanceIds && instanceIds.length > 0) {
    const idSet = new Set(instanceIds);
    infraRows = infraRows.filter((r) => idSet.has(r.instanceId));
  }

  // Fetch status for each service with bounded concurrency
  const results: BatchStatusResponse["services"] = [];

  for (let i = 0; i < infraRows.length; i += STATUS_CONCURRENCY) {
    const batch = infraRows.slice(i, i + STATUS_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (row) => {
        const status = await railway.fetchServiceStatus(
          row.providerServiceId,
          row.providerEnvId,
        );
        return {
          instanceId: row.instanceId,
          serviceId: row.providerServiceId,
          name: `convos-agent-${row.instanceId}`,
          deployStatus: status?.deployStatus || row.deployStatus || null,
          domain: status?.domain || (row.url ? row.url.replace("https://", "") : null),
          image: status?.image || row.runtimeImage || null,
          environmentIds: row.providerEnvId ? [row.providerEnvId] : [],
        };
      }),
    );

    for (const s of settled) {
      if (s.status === "fulfilled") {
        results.push(s.value);
      }
    }
  }

  // Send to Datadog without logging — tick() logs a single summary line
  sendMetricSilent("batch_status.duration_ms", Date.now() - batchStart);
  sendMetricSilent("batch_status.count", results.length);

  return { services: results };
}
