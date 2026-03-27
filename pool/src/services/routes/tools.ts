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
    let envValue: string | null = null;
    const resourceMeta: Record<string, unknown> = {};
    let pushEnvToRailway: Record<string, string> | null = null;

    if (toolId === "openrouter") {
      if (!config.openrouterManagementKey) {
        res.status(400).json({ error: "OPENROUTER_MANAGEMENT_KEY not configured" });
        return;
      }
      const keyName = `assistant-${config.poolEnvironment}-${instanceId}`;
      const limit = (toolConfig?.limit as number) ?? config.openrouterKeyLimit;
      const { key, hash } = await openrouter.createKey(keyName, limit);
      resourceId = hash;
      envValue = key;
      resourceMeta.limit = limit;
      // OpenRouter key is still pushed as env var (instances call OpenRouter directly)
      pushEnvToRailway = { OPENROUTER_API_KEY: key };
    } else if (toolId === "agentmail") {
      if (!config.agentmailApiKey) {
        res.status(400).json({ error: "AGENTMAIL_API_KEY not configured" });
        return;
      }
      const inboxId = await agentmail.createInbox(instanceId);
      resourceId = inboxId;
      envValue = inboxId;
      // No env push — proxied through pool manager
    } else if (toolId === "telnyx") {
      if (!config.telnyxApiKey) {
        res.status(400).json({ error: "TELNYX_API_KEY not configured" });
        return;
      }
      const { phoneNumber, messagingProfileId } = await telnyx.provisionPhone(instanceId);
      resourceId = phoneNumber;
      envValue = phoneNumber;
      resourceMeta.messagingProfileId = messagingProfileId;
      // No env push — proxied through pool manager
    } else {
      res.status(400).json({ error: `Unknown tool: ${toolId}` });
      return;
    }

    // Push env var to Railway service (only for tools that need direct access)
    if (pushEnvToRailway) {
      await railway.upsertVariables(infra.providerServiceId, pushEnvToRailway);
    }

    // Insert instance_services row
    await db.insert(instanceServices).values({
      instanceId,
      toolId,
      resourceId,
      envKey: toolId, // legacy column — no longer used as env var name
      envValue,
      resourceMeta,
    });

    // Update profile metadata on the runtime with the provisioned value
    if ((toolId === "agentmail" || toolId === "telnyx") && infra.url && infra.gatewayToken) {
      const metaKey = toolId === "agentmail" ? "email" : "phone";
      fetch(`${infra.url}/convos/update-metadata`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${infra.gatewayToken}`,
        },
        body: JSON.stringify({ metadata: { [metaKey]: resourceId } }),
        signal: AbortSignal.timeout(10_000),
      }).catch((err) => console.warn(`[tools] metadata update for ${toolId} failed: ${err.message}`));
    }

    const result: ProvisionResult = { toolId, resourceId, status: "active" };
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
