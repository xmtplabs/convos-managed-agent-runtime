import { Router } from "express";
import { sql } from "../db/connection.js";
import * as railway from "../providers/railway.js";
import * as openrouter from "../providers/openrouter.js";
import * as agentmail from "../providers/agentmail.js";
import * as telnyx from "../providers/telnyx.js";
import { config } from "../config.js";
import type { ProvisionResult } from "../types.js";

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
    const infraResult = await sql`SELECT * FROM instance_infra WHERE instance_id = ${instanceId}`;
    const infra = infraResult.rows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    // Check if already provisioned
    const existing = await sql`
      SELECT * FROM instance_services WHERE instance_id = ${instanceId} AND tool_id = ${toolId}
    `;
    if (existing.rows.length > 0) {
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
    await railway.upsertVariables(infra.provider_service_id, { [envKey]: envValue! });

    // Insert instance_services row
    await sql`
      INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value, resource_meta)
      VALUES (${instanceId}, ${toolId}, ${resourceId}, ${envKey}, ${envValue}, ${JSON.stringify(resourceMeta)})
    `;

    const result: ProvisionResult = { toolId, resourceId, envKey, status: "active" };
    console.log(`[tools] Provisioned ${toolId} for ${instanceId}: ${resourceId}`);
    res.json(result);
  } catch (err: any) {
    console.error("[tools] provision failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /provision-local
 * Provision tools for local dev — no instance infra, no Railway, no DB rows.
 * Just creates the resources and returns env vars.
 */
toolsRouter.post("/provision-local", async (req, res) => {
  try {
    const { tools = ["openrouter", "agentmail"] } = req.body as { tools?: string[] };
    const label = `local-${Date.now()}`;
    const env: Record<string, string> = {};

    if (tools.includes("openrouter") && config.openrouterManagementKey) {
      const keyName = `convos-local-${label}`;
      const { key } = await openrouter.createKey(keyName);
      env.OPENROUTER_API_KEY = key;
    }

    if (tools.includes("agentmail") && config.agentmailApiKey) {
      const inboxId = await agentmail.createInbox(label);
      env.AGENTMAIL_INBOX_ID = inboxId;
    }

    if (tools.includes("telnyx") && config.telnyxApiKey) {
      const { phoneNumber, messagingProfileId } = await telnyx.provisionPhone();
      env.TELNYX_PHONE_NUMBER = phoneNumber;
      env.TELNYX_MESSAGING_PROFILE_ID = messagingProfileId;
    }

    console.log(`[tools] Provisioned local: ${Object.keys(env).join(", ")}`);
    res.json({ env });
  } catch (err: any) {
    console.error("[tools] provision-local failed:", err);
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
    await sql`
      DELETE FROM instance_services
      WHERE instance_id = ${instanceId} AND tool_id = ${toolId} AND resource_id = ${resourceId}
    `;

    console.log(`[tools] Destroyed ${toolId}/${resourceId} for ${instanceId}`);
    res.json({ toolId, resourceId, deleted });
  } catch (err: any) {
    console.error("[tools] destroy failed:", err);
    res.status(500).json({ error: err.message });
  }
});
