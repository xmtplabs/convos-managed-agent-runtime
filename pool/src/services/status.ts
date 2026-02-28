import { db } from "../db/connection";
import { instanceInfra } from "../db/schema";
import type { InfraRow } from "../db/schema";
import * as railway from "./providers/railway";
import { sendMetricSilent } from "../metrics";
import type { BatchStatusResponse } from "../types";

const LEGACY_CONCURRENCY = 5;

/**
 * Fetch batch status for all agent services.
 * Groups instances by providerProjectId and calls listProjectServices once per
 * project instead of N individual fetchServiceStatus calls.
 * Legacy rows with NULL providerProjectId fall back to individual calls.
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

  // Partition: rows with a project ID vs legacy rows without one
  const byProject = new Map<string, InfraRow[]>();
  const legacyRows: InfraRow[] = [];

  for (const row of infraRows) {
    if (row.providerProjectId) {
      const arr = byProject.get(row.providerProjectId);
      if (arr) arr.push(row);
      else byProject.set(row.providerProjectId, [row]);
    } else {
      legacyRows.push(row);
    }
  }

  const results: BatchStatusResponse["services"] = [];

  // ── Batch path: 1 GQL call per project ──────────────────────────────────────
  const projectCalls = Array.from(byProject.entries()).map(
    async ([projectId, rows]) => {
      // All rows in a project share the same envId, pick from the first
      const envId = rows[0].providerEnvId;
      const services = await railway.listProjectServices(projectId, envId);
      if (!services) return;

      // Index by service ID for O(1) lookup
      const serviceMap = new Map(services.map((s) => [s.id, s]));

      for (const row of rows) {
        const svc = serviceMap.get(row.providerServiceId);
        results.push({
          instanceId: row.instanceId,
          serviceId: row.providerServiceId,
          name: `convos-agent-${row.instanceId}`,
          deployStatus: svc?.deployStatus || row.deployStatus || null,
          domain: svc?.domain || (row.url ? row.url.replace("https://", "") : null),
          image: svc?.image || row.runtimeImage || null,
          environmentIds: svc?.environmentIds || (row.providerEnvId ? [row.providerEnvId] : []),
        });
      }
    },
  );

  await Promise.allSettled(projectCalls);

  // ── Legacy fallback: individual calls with bounded concurrency ──────────────
  for (let i = 0; i < legacyRows.length; i += LEGACY_CONCURRENCY) {
    const batch = legacyRows.slice(i, i + LEGACY_CONCURRENCY);
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
      if (s.status === "fulfilled") results.push(s.value);
    }
  }

  // Send to Datadog without logging — tick() logs a single summary line
  sendMetricSilent("batch_status.duration_ms", Date.now() - batchStart);
  sendMetricSilent("batch_status.count", results.length);
  sendMetricSilent("batch_status.project_calls", byProject.size);
  sendMetricSilent("batch_status.legacy_calls", legacyRows.length);

  return { services: results };
}
