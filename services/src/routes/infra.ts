import { Router } from "express";
import { sql } from "../db/connection.js";
import * as railway from "../providers/railway.js";
import * as openrouter from "../providers/openrouter.js";
import * as agentmail from "../providers/agentmail.js";
import * as telnyx from "../providers/telnyx.js";
import * as wallet from "../providers/wallet.js";
import { buildInstanceEnv } from "../providers/env.js";
import { config } from "../config.js";
import type { CreateInstanceRequest, CreateInstanceResponse, DestroyResult } from "../types.js";

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

    const environmentId = config.railwayEnvironmentId || process.env.RAILWAY_ENVIRONMENT_ID;
    if (!environmentId) {
      res.status(500).json({ error: "RAILWAY_ENVIRONMENT_ID not set" });
      return;
    }

    // Generate secrets
    const gatewayToken = wallet.generateGatewayToken();
    const setupPassword = wallet.generateSetupPassword();
    const walletKey = wallet.generatePrivateWalletKey();

    // Build env vars
    const vars: Record<string, string> = { ...buildInstanceEnv() };
    vars.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
    vars.SETUP_PASSWORD = setupPassword;
    vars.PRIVATE_WALLET_KEY = walletKey;

    // Provision requested tools
    const services: CreateInstanceResponse["services"] = {};

    if (tools.includes("openrouter") && config.openrouterManagementKey) {
      const keyName = `convos-agent-${instanceId}`;
      const { key, hash } = await openrouter.createKey(keyName);
      vars.OPENROUTER_API_KEY = key;
      services.openrouter = { resourceId: hash };
    }

    if (tools.includes("agentmail") && config.agentmailApiKey) {
      const inboxId = await agentmail.createInbox(instanceId);
      vars.AGENTMAIL_INBOX_ID = inboxId;
      services.agentmail = { resourceId: inboxId };
    }

    if (tools.includes("telnyx") && config.telnyxApiKey) {
      const { phoneNumber, messagingProfileId } = await telnyx.provisionPhone();
      vars.TELNYX_PHONE_NUMBER = phoneNumber;
      vars.TELNYX_MESSAGING_PROFILE_ID = messagingProfileId;
      services.telnyx = { resourceId: phoneNumber };
    }

    // Create Railway service
    const serviceId = await railway.createService(name, vars);
    console.log(`[infra] Railway service created: ${serviceId}`);

    // Create volume
    const hasVolume = await railway.ensureVolume(serviceId);
    if (!hasVolume) console.warn(`[infra] Volume creation failed for ${serviceId}`);

    // Create domain
    let url: string | null = null;
    try {
      const domain = await railway.createDomain(serviceId);
      url = `https://${domain}`;
      console.log(`[infra] Domain: ${url}`);
    } catch (err: any) {
      console.warn(`[infra] Domain creation failed for ${serviceId}: ${err.message}`);
    }

    // Insert into instance_infra
    await sql`
      INSERT INTO instance_infra (instance_id, provider, provider_service_id, provider_env_id, provider_project_id, url, deploy_status, runtime_image)
      VALUES (${instanceId}, 'railway', ${serviceId}, ${environmentId}, ${config.railwayProjectId}, ${url}, 'BUILDING', ${config.railwayRuntimeImage})
    `;

    // Insert instance_services rows
    if (services.openrouter) {
      await sql`
        INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value, resource_meta)
        VALUES (${instanceId}, 'openrouter', ${services.openrouter.resourceId}, 'OPENROUTER_API_KEY', ${vars.OPENROUTER_API_KEY}, '{}')
      `;
    }
    if (services.agentmail) {
      await sql`
        INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value)
        VALUES (${instanceId}, 'agentmail', ${services.agentmail.resourceId}, 'AGENTMAIL_INBOX_ID', ${vars.AGENTMAIL_INBOX_ID || null})
      `;
    }
    if (services.telnyx) {
      await sql`
        INSERT INTO instance_services (instance_id, tool_id, resource_id, env_key, env_value, resource_meta)
        VALUES (${instanceId}, 'telnyx', ${services.telnyx.resourceId}, 'TELNYX_PHONE_NUMBER', ${vars.TELNYX_PHONE_NUMBER}, ${JSON.stringify({ messagingProfileId: vars.TELNYX_MESSAGING_PROFILE_ID })})
      `;
    }

    const response: CreateInstanceResponse = {
      instanceId,
      serviceId,
      url,
      services,
    };

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

    // Look up infra row
    const infraResult = await sql`SELECT * FROM instance_infra WHERE instance_id = ${instanceId}`;
    const infra = infraResult.rows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    // Look up service rows
    const svcResult = await sql`SELECT * FROM instance_services WHERE instance_id = ${instanceId}`;
    const svcRows = svcResult.rows;

    const destroyed: DestroyResult["destroyed"] = {
      openrouter: false,
      agentmail: false,
      telnyx: false,
      volumes: false,
      service: false,
    };

    // Delete tool resources
    for (const svc of svcRows) {
      try {
        if (svc.tool_id === "openrouter") {
          destroyed.openrouter = await openrouter.deleteKey(svc.resource_id);
        } else if (svc.tool_id === "agentmail") {
          destroyed.agentmail = await agentmail.deleteInbox(svc.resource_id);
        } else if (svc.tool_id === "telnyx") {
          destroyed.telnyx = await telnyx.deletePhone(svc.resource_id);
        }
      } catch (err: any) {
        console.warn(`[infra] Failed to delete ${svc.tool_id} resource for ${instanceId}:`, err.message);
      }
    }

    // Delete volumes
    const serviceId = infra.provider_service_id;
    try {
      const volumeMap = await railway.fetchAllVolumesByService();
      const volumeIds = volumeMap?.get(serviceId) || [];
      for (const volId of volumeIds) {
        await railway.deleteVolume(volId, serviceId);
      }
      destroyed.volumes = true;
    } catch (err: any) {
      console.warn(`[infra] Volume cleanup failed for ${instanceId}:`, err.message);
    }

    // Delete Railway service (3x retry)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await railway.deleteService(serviceId);
        destroyed.service = true;
        break;
      } catch (err: any) {
        console.warn(`[infra] Delete service attempt ${attempt}/3 failed for ${serviceId}: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }

    // Delete DB rows (cascade handles instance_services)
    await sql`DELETE FROM instance_infra WHERE instance_id = ${instanceId}`;

    console.log(`[infra] Instance ${instanceId} destroyed`);
    res.json({ instanceId, destroyed });
  } catch (err: any) {
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

    const infraResult = await sql`SELECT * FROM instance_infra WHERE instance_id = ${instanceId}`;
    const infra = infraResult.rows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    await railway.redeployService(infra.provider_service_id);
    console.log(`[infra] Redeployed instance ${instanceId}`);
    res.json({ instanceId, ok: true });
  } catch (err: any) {
    console.error("[infra] redeploy failed:", err);
    res.status(500).json({ error: err.message });
  }
});
