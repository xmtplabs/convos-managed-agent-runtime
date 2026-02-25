import { Router } from "express";
import { sql } from "../../db/connection.js";
import * as railway from "../providers/railway.js";

export const configureRouter = Router();

/**
 * POST /configure/:instanceId
 * Set env vars on an instance's Railway service.
 */
configureRouter.post("/configure/:instanceId", async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { variables, redeploy = false } = req.body as {
      variables: Record<string, string>;
      redeploy?: boolean;
    };

    if (!variables || Object.keys(variables).length === 0) {
      res.status(400).json({ error: "variables object is required" });
      return;
    }

    // Look up infra row
    const infraResult = await sql`SELECT * FROM instance_infra WHERE instance_id = ${instanceId}`;
    const infra = infraResult.rows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    await railway.upsertVariables(infra.provider_service_id, variables, {
      skipDeploys: !redeploy,
    });

    if (redeploy) {
      await railway.redeployService(infra.provider_service_id);
    }

    console.log(`[configure] Updated ${Object.keys(variables).length} var(s) for ${instanceId}`);
    res.json({ instanceId, ok: true });
  } catch (err: any) {
    console.error("[configure] failed:", err);
    res.status(500).json({ error: err.message });
  }
});
