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
