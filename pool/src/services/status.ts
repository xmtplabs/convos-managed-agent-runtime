import * as railway from "./providers/railway";
import { config } from "../config";
import type { BatchStatusResponse } from "../types";

/**
 * Fetch batch status for all agent services.
 * Extracted from POST /status/batch route handler.
 */
export async function fetchBatchStatus(instanceIds?: string[]): Promise<BatchStatusResponse> {
  const allServices = await railway.listProjectServices();
  if (allServices === null) throw new Error("Failed to fetch services from Railway");

  const envId = config.railwayEnvironmentId;

  let agents = allServices.filter(
    (s) =>
      s.name.startsWith("convos-agent-") &&
      s.name !== "convos-agent-pool-manager" &&
      (!envId || s.environmentIds.includes(envId)),
  );

  if (instanceIds && instanceIds.length > 0) {
    const idSet = new Set(instanceIds);
    agents = agents.filter((s) => {
      const instId = s.name.replace("convos-agent-", "");
      return idSet.has(instId);
    });
  }

  return {
    projectId: config.railwayProjectId,
    services: agents.map((s) => ({
      instanceId: s.name.replace("convos-agent-", ""),
      serviceId: s.id,
      name: s.name,
      deployStatus: s.deployStatus,
      domain: s.domain,
      image: s.image,
      environmentIds: s.environmentIds,
    })),
  };
}
