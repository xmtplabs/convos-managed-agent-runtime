import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/connection";
import { instanceInfra, instanceServices } from "../../db/schema";
import * as openrouter from "../providers/openrouter";
import * as railway from "../providers/railway";
import * as agentmail from "../providers/agentmail";
import * as telnyx from "../providers/telnyx";

export const dashboardRouter = Router();

/**
 * GET /dashboard/instances
 * All instances with their provisioned tools.
 */
dashboardRouter.get("/dashboard/instances", async (_req, res) => {
  try {
    // LEFT JOIN with json_agg — keep as raw SQL (Drizzle doesn't have native json_agg)
    const result = await db.execute(sql`
      SELECT i.*,
             COALESCE(json_agg(s.*) FILTER (WHERE s.id IS NOT NULL), '[]') AS tools
      FROM instance_infra i
      LEFT JOIN instance_services s ON s.instance_id = i.instance_id
      GROUP BY i.instance_id
      ORDER BY i.created_at DESC
    `);
    res.json(result.rows);
  } catch (err: any) {
    console.error("[dashboard] instances failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /dashboard/credits
 * OpenRouter account credits + per-key usage.
 */
dashboardRouter.get("/dashboard/credits", async (_req, res) => {
  try {
    const [credits, keys] = await Promise.all([
      openrouter.getCredits(),
      openrouter.listKeys(),
    ]);
    res.json({ credits, keys });
  } catch (err: any) {
    console.error("[dashboard] credits failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /dashboard/inboxes
 * AgentMail inbox count.
 */
dashboardRouter.get("/dashboard/inboxes", async (_req, res) => {
  try {
    const result = await agentmail.listInboxes();
    res.json(result);
  } catch (err: any) {
    console.error("[dashboard] inboxes failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /dashboard/topup/:keyHash
 * Update the spending limit on an OpenRouter key.
 */
dashboardRouter.patch("/dashboard/topup/:keyHash", async (req, res) => {
  try {
    const { keyHash } = req.params;
    const { limit } = req.body;
    if (typeof limit !== "number" || limit <= 0) {
      res.status(400).json({ error: "limit must be a positive number" });
      return;
    }
    const result = await openrouter.updateKeyLimit(keyHash, limit);
    res.json({ ok: true, data: result });
  } catch (err: any) {
    console.error("[dashboard] topup failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /dashboard/kill/:instanceId
 * Destroys an instance and all its resources (Railway service, tools, DB rows).
 */
dashboardRouter.delete("/dashboard/kill/:instanceId", async (req, res) => {
  try {
    const { instanceId } = req.params;

    const infraRows = await db.select().from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    const svcRows = await db.select().from(instanceServices).where(eq(instanceServices.instanceId, instanceId));

    // Delete tool resources
    for (const svc of svcRows) {
      try {
        if (svc.toolId === "openrouter") await openrouter.deleteKey(svc.resourceId);
        else if (svc.toolId === "agentmail") await agentmail.deleteInbox(svc.resourceId);
        else if (svc.toolId === "telnyx") await telnyx.deletePhone(svc.resourceId);
      } catch (err: any) {
        console.warn(`[dashboard] Failed to delete ${svc.toolId} for ${instanceId}:`, err.message);
      }
    }

    // Delete volumes + Railway service
    const serviceId = infra.providerServiceId;
    try {
      const volumeMap = await railway.fetchAllVolumesByService();
      for (const volId of volumeMap?.get(serviceId) || []) {
        await railway.deleteVolume(volId, serviceId);
      }
    } catch (err: any) {
      console.warn(`[dashboard] Volume cleanup failed for ${instanceId}:`, err.message);
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await railway.deleteService(serviceId);
        break;
      } catch (err: any) {
        console.warn(`[dashboard] Delete service attempt ${attempt}/3 for ${serviceId}: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }

    await db.delete(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
    console.log(`[dashboard] Instance ${instanceId} destroyed`);
    res.json({ ok: true, instanceId });
  } catch (err: any) {
    console.error("[dashboard] kill failed:", err);
    res.status(500).json({ error: err.message });
  }
});
