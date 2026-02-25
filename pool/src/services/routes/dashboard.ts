import { Router } from "express";
import { sql } from "../../db/connection.js";
import * as openrouter from "../providers/openrouter.js";
import * as railway from "../providers/railway.js";
import * as agentmail from "../providers/agentmail.js";
import * as telnyx from "../providers/telnyx.js";

export const dashboardRouter = Router();

/**
 * GET /dashboard/instances
 * All instances with their provisioned tools.
 */
dashboardRouter.get("/dashboard/instances", async (_req, res) => {
  try {
    const result = await sql`
      SELECT i.*,
             COALESCE(json_agg(s.*) FILTER (WHERE s.id IS NOT NULL), '[]') AS tools
      FROM instance_infra i
      LEFT JOIN instance_services s ON s.instance_id = i.instance_id
      GROUP BY i.instance_id
      ORDER BY i.created_at DESC
    `;
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
 * DELETE /dashboard/kill/:instanceId
 * Destroys an instance and all its resources (Railway service, tools, DB rows).
 */
dashboardRouter.delete("/dashboard/kill/:instanceId", async (req, res) => {
  try {
    const { instanceId } = req.params;

    const infraResult = await sql`SELECT * FROM instance_infra WHERE instance_id = ${instanceId}`;
    const infra = infraResult.rows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    const svcResult = await sql`SELECT * FROM instance_services WHERE instance_id = ${instanceId}`;

    // Delete tool resources
    for (const svc of svcResult.rows) {
      try {
        if (svc.tool_id === "openrouter") await openrouter.deleteKey(svc.resource_id);
        else if (svc.tool_id === "agentmail") await agentmail.deleteInbox(svc.resource_id);
        else if (svc.tool_id === "telnyx") await telnyx.deletePhone(svc.resource_id);
      } catch (err: any) {
        console.warn(`[dashboard] Failed to delete ${svc.tool_id} for ${instanceId}:`, err.message);
      }
    }

    // Delete volumes + Railway service
    const serviceId = infra.provider_service_id;
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

    await sql`DELETE FROM instance_infra WHERE instance_id = ${instanceId}`;
    console.log(`[dashboard] Instance ${instanceId} destroyed`);
    res.json({ ok: true, instanceId });
  } catch (err: any) {
    console.error("[dashboard] kill failed:", err);
    res.status(500).json({ error: err.message });
  }
});
