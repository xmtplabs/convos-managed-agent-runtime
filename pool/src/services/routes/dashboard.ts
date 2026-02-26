import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../db/connection";
import { destroyInstance } from "../infra";
import * as openrouter from "../providers/openrouter";
import * as agentmail from "../providers/agentmail";

export const dashboardRouter = Router();

/**
 * GET /dashboard/instances
 * All instances with their provisioned tools.
 */
dashboardRouter.get("/dashboard/instances", async (_req, res) => {
  try {
    // Explicit columns — exclude gateway_token (infra) and env_value (services)
    const result = await db.execute(sql`
      SELECT i.instance_id, i.provider, i.provider_service_id, i.provider_env_id,
             i.provider_project_id, i.url, i.deploy_status, i.runtime_image,
             i.volume_id, i.created_at, i.updated_at,
             COALESCE(json_agg(json_build_object(
               'id', s.id, 'instance_id', s.instance_id, 'tool_id', s.tool_id,
               'resource_id', s.resource_id, 'resource_meta', s.resource_meta,
               'env_key', s.env_key, 'status', s.status, 'created_at', s.created_at
             )) FILTER (WHERE s.id IS NOT NULL), '[]') AS tools
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
 * GET /dashboard/keys/count
 * Total OpenRouter provisioned key count.
 */
dashboardRouter.get("/dashboard/keys/count", async (_req, res) => {
  try {
    const count = await openrouter.countKeys();
    res.json({ count });
  } catch (err: any) {
    console.error("[dashboard] keys count failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /dashboard/phones
 * Phone number pool counts.
 */
dashboardRouter.get("/dashboard/phones", async (_req, res) => {
  try {
    const result = await db.execute<{ status: string; count: string }>(sql`
      SELECT status, COUNT(*)::text AS count FROM phone_number_pool GROUP BY status
    `);
    const counts: Record<string, number> = { available: 0, assigned: 0, total: 0 };
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
      counts.total += parseInt(row.count, 10);
    }
    res.json(counts);
  } catch (err: any) {
    console.error("[dashboard] phones failed:", err);
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
    await destroyInstance(instanceId);
    console.log(`[dashboard] Instance ${instanceId} destroyed`);
    res.json({ ok: true, instanceId });
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error("[dashboard] kill failed:", err);
    res.status(500).json({ error: err.message });
  }
});
