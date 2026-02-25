import { Router } from "express";
import * as railway from "../providers/railway.js";
import { config } from "../config.js";
import type { BatchStatusResponse } from "../types.js";

export const statusRouter = Router();

/**
 * POST /status/batch
 * Returns deploy status for all (or filtered) agent services.
 */
statusRouter.post("/status/batch", async (req, res) => {
  try {
    const { instanceIds } = req.body as { instanceIds?: string[] };

    const allServices = await railway.listProjectServices();
    if (allServices === null) {
      res.status(502).json({ error: "Failed to fetch services from Railway" });
      return;
    }

    const envId = config.railwayEnvironmentId;

    // Filter to convos-agent-* in current environment
    let agents = allServices.filter(
      (s) =>
        s.name.startsWith("convos-agent-") &&
        s.name !== "convos-agent-pool-manager" &&
        (!envId || s.environmentIds.includes(envId)),
    );

    // If specific instanceIds requested, filter further
    if (instanceIds && instanceIds.length > 0) {
      const idSet = new Set(instanceIds);
      agents = agents.filter((s) => {
        const instId = s.name.replace("convos-agent-", "");
        return idSet.has(instId);
      });
    }

    const response: BatchStatusResponse = {
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

    res.json(response);
  } catch (err: any) {
    console.error("[status] batch failed:", err);
    res.status(500).json({ error: err.message });
  }
});
