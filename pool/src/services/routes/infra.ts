import { Router } from "express";
import { createInstance, destroyInstance } from "../infra";
import { redeployService } from "../providers/railway";
import { eq } from "drizzle-orm";
import { db } from "../../db/connection";
import { instanceInfra } from "../../db/schema";
import type { CreateInstanceRequest } from "../../types";

export const infraRouter = Router();

/**
 * POST /create-instance
 * Creates a Railway service with secrets and requested tool provisioning.
 */
infraRouter.post("/create-instance", async (req, res) => {
  try {
    const { instanceId, name, tools = [] } = req.body as CreateInstanceRequest;
    if (!instanceId || !name) {
      res.status(400).json({ error: "instanceId and name are required" });
      return;
    }

    const response = await createInstance(instanceId, name, tools);
    console.log(`[infra] Instance ${instanceId} created successfully`);
    res.json(response);
  } catch (err: any) {
    console.error("[infra] create-instance failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /destroy/:instanceId
 * Destroys all resources for an instance.
 */
infraRouter.delete("/destroy/:instanceId", async (req, res) => {
  try {
    const { instanceId } = req.params;
    const result = await destroyInstance(instanceId);
    res.json(result);
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error("[infra] destroy failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /redeploy/:instanceId
 * Redeploys the latest deployment for an instance.
 */
infraRouter.post("/redeploy/:instanceId", async (req, res) => {
  try {
    const { instanceId } = req.params;

    const infraRows = await db.select().from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    await redeployService(infra.providerServiceId);
    console.log(`[infra] Redeployed instance ${instanceId}`);
    res.json({ instanceId, ok: true });
  } catch (err: any) {
    console.error("[infra] redeploy failed:", err);
    res.status(500).json({ error: err.message });
  }
});
