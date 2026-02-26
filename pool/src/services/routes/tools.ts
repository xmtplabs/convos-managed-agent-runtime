import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../../db/connection";
import { instanceInfra, instanceServices } from "../../db/schema";
import * as railway from "../providers/railway";
import * as openrouter from "../providers/openrouter";
import * as agentmail from "../providers/agentmail";
import * as telnyx from "../providers/telnyx";
import { config } from "../../config";
import type { ProvisionResult } from "../../types";

export const toolsRouter = Router();

/**
 * POST /provision/:instanceId/:toolId
 * Provision a single tool for an instance.
 */
toolsRouter.post("/provision/:instanceId/:toolId", async (req, res) => {
  try {
    const { instanceId, toolId } = req.params;
    const { config: toolConfig } = req.body as { config?: Record<string, unknown> };

    // Verify instance exists
    const infraRows = await db.select().from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    // Check if already provisioned
    const existing = await db.select().from(instanceServices).where(
      and(eq(instanceServices.instanceId, instanceId), eq(instanceServices.toolId, toolId))
    );
    if (existing.length > 0) {
      res.status(409).json({ error: `Tool ${toolId} already provisioned for ${instanceId}` });
      return;
    }

    let resourceId: string;
    let envKey: string;
    let envValue: string | null = null;
    const resourceMeta: Record<string, unknown> = {};

    if (toolId === "openrouter") {
      if (!config.openrouterManagementKey) {
        res.status(400).json({ error: "OPENROUTER_MANAGEMENT_KEY not configured" });
        return;
      }
      const keyName = `convos-agent-${instanceId}`;
      const limit = (toolConfig?.limit as number) ?? config.openrouterKeyLimit;
      const { key, hash } = await openrouter.createKey(keyName, limit);
      resourceId = hash;
      envKey = "OPENROUTER_API_KEY";
      envValue = key;
      resourceMeta.limit = limit;
    } else if (toolId === "agentmail") {
      if (!config.agentmailApiKey) {
        res.status(400).json({ error: "AGENTMAIL_API_KEY not configured" });
        return;
      }
      const inboxId = await agentmail.createInbox(instanceId);
      resourceId = inboxId;
      envKey = "AGENTMAIL_INBOX_ID";
      envValue = inboxId;
    } else if (toolId === "telnyx") {
      if (!config.telnyxApiKey) {
        res.status(400).json({ error: "TELNYX_API_KEY not configured" });
        return;
      }
      const { phoneNumber, messagingProfileId } = await telnyx.provisionPhone();
      resourceId = phoneNumber;
      envKey = "TELNYX_PHONE_NUMBER";
      envValue = phoneNumber;
      resourceMeta.messagingProfileId = messagingProfileId;
    } else {
      res.status(400).json({ error: `Unknown tool: ${toolId}` });
      return;
    }

    // Push env var to Railway service
    await railway.upsertVariables(infra.providerServiceId, { [envKey]: envValue! });

    // Insert instance_services row
    await db.insert(instanceServices).values({
      instanceId,
      toolId,
      resourceId,
      envKey,
      envValue,
      resourceMeta,
    });

    const result: ProvisionResult = { toolId, resourceId, envKey, status: "active" };
    console.log(`[tools] Provisioned ${toolId} for ${instanceId}: ${resourceId}`);
    res.json(result);
  } catch (err: any) {
    console.error("[tools] provision failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /destroy/:instanceId/:toolId/:resourceId
 * Destroy a specific tool resource for an instance.
 */
toolsRouter.delete("/destroy/:instanceId/:toolId/:resourceId", async (req, res) => {
  try {
    const { instanceId, toolId, resourceId } = req.params;

    let deleted = false;
    if (toolId === "openrouter") {
      deleted = await openrouter.deleteKey(resourceId);
    } else if (toolId === "agentmail") {
      deleted = await agentmail.deleteInbox(resourceId);
    } else if (toolId === "telnyx") {
      deleted = await telnyx.deletePhone(resourceId);
    } else {
      res.status(400).json({ error: `Unknown tool: ${toolId}` });
      return;
    }

    // Remove from DB
    await db.delete(instanceServices).where(
      and(
        eq(instanceServices.instanceId, instanceId),
        eq(instanceServices.toolId, toolId),
        eq(instanceServices.resourceId, resourceId),
      )
    );

    console.log(`[tools] Destroyed ${toolId}/${resourceId} for ${instanceId}`);
    res.json({ toolId, resourceId, deleted });
  } catch (err: any) {
    console.error("[tools] destroy failed:", err);
    res.status(500).json({ error: err.message });
  }
});
