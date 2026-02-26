import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/connection";
import { instanceInfra, instanceServices } from "../../db/schema";
import * as railway from "../providers/railway";
import * as openrouter from "../providers/openrouter";
import * as agentmail from "../providers/agentmail";
import * as telnyx from "../providers/telnyx";
import * as wallet from "../providers/wallet";
import { buildInstanceEnv } from "../providers/env";
import { config } from "../../config";
import type { CreateInstanceRequest, CreateInstanceResponse, DestroyResult } from "../../types";

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
    await db.insert(instanceInfra).values({
      instanceId,
      provider: "railway",
      providerServiceId: serviceId,
      providerEnvId: environmentId,
      providerProjectId: config.railwayProjectId,
      url,
      deployStatus: "BUILDING",
      runtimeImage: config.railwayRuntimeImage,
    });

    // Insert instance_services rows
    if (services.openrouter) {
      await db.insert(instanceServices).values({
        instanceId,
        toolId: "openrouter",
        resourceId: services.openrouter.resourceId,
        envKey: "OPENROUTER_API_KEY",
        envValue: vars.OPENROUTER_API_KEY,
        resourceMeta: {},
      });
    }
    if (services.agentmail) {
      await db.insert(instanceServices).values({
        instanceId,
        toolId: "agentmail",
        resourceId: services.agentmail.resourceId,
        envKey: "AGENTMAIL_INBOX_ID",
        envValue: vars.AGENTMAIL_INBOX_ID || null,
      });
    }
    if (services.telnyx) {
      await db.insert(instanceServices).values({
        instanceId,
        toolId: "telnyx",
        resourceId: services.telnyx.resourceId,
        envKey: "TELNYX_PHONE_NUMBER",
        envValue: vars.TELNYX_PHONE_NUMBER,
        resourceMeta: { messagingProfileId: vars.TELNYX_MESSAGING_PROFILE_ID },
      });
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
    const infraRows = await db.select().from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    // Look up service rows
    const svcRows = await db.select().from(instanceServices).where(eq(instanceServices.instanceId, instanceId));

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
        if (svc.toolId === "openrouter") {
          destroyed.openrouter = await openrouter.deleteKey(svc.resourceId);
        } else if (svc.toolId === "agentmail") {
          destroyed.agentmail = await agentmail.deleteInbox(svc.resourceId);
        } else if (svc.toolId === "telnyx") {
          destroyed.telnyx = await telnyx.deletePhone(svc.resourceId);
        }
      } catch (err: any) {
        console.warn(`[infra] Failed to delete ${svc.toolId} resource for ${instanceId}:`, err.message);
      }
    }

    // Delete volumes
    const serviceId = infra.providerServiceId;
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
    await db.delete(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));

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

    const infraRows = await db.select().from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
    const infra = infraRows[0];
    if (!infra) {
      res.status(404).json({ error: `Instance ${instanceId} not found` });
      return;
    }

    await railway.redeployService(infra.providerServiceId);
    console.log(`[infra] Redeployed instance ${instanceId}`);
    res.json({ instanceId, ok: true });
  } catch (err: any) {
    console.error("[infra] redeploy failed:", err);
    res.status(500).json({ error: err.message });
  }
});
