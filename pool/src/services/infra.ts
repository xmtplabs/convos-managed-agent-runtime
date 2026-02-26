import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { instanceInfra, instanceServices } from "../db/schema";
import * as railway from "./providers/railway";
import * as openrouter from "./providers/openrouter";
import * as agentmail from "./providers/agentmail";
import * as telnyx from "./providers/telnyx";
import * as wallet from "./providers/wallet";
import { buildInstanceEnv } from "./providers/env";
import { config } from "../config";
import type { CreateInstanceResponse, DestroyResult } from "../types";

/**
 * Create a new instance: Railway service + tools + DB rows.
 */
export async function createInstance(
  instanceId: string,
  name: string,
  tools: string[] = ["openrouter", "agentmail"],
): Promise<CreateInstanceResponse> {
  const environmentId = config.railwayEnvironmentId || process.env.RAILWAY_ENVIRONMENT_ID;
  if (!environmentId) throw new Error("RAILWAY_ENVIRONMENT_ID not set");

  // Generate secrets
  const gatewayToken = wallet.generateGatewayToken();
  const setupPassword = wallet.generateSetupPassword();
  const walletKey = wallet.generatePrivateWalletKey();

  // Build env vars
  const vars: Record<string, string> = { ...buildInstanceEnv() };
  vars.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  vars.SETUP_PASSWORD = setupPassword;
  vars.PRIVATE_WALLET_KEY = walletKey;

  // Provision requested tools (rollback on failure to avoid leaked resources)
  const services: CreateInstanceResponse["services"] = {};

  try {
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
  } catch (err) {
    console.error(`[infra] Provisioning failed for ${instanceId}, rolling back...`);
    if (services.openrouter) {
      try { await openrouter.deleteKey(services.openrouter.resourceId); } catch (e: any) {
        console.warn(`[infra] Rollback openrouter failed: ${e.message}`);
      }
    }
    if (services.agentmail) {
      try { await agentmail.deleteInbox(services.agentmail.resourceId); } catch (e: any) {
        console.warn(`[infra] Rollback agentmail failed: ${e.message}`);
      }
    }
    if (services.telnyx) {
      try { await telnyx.deletePhone(services.telnyx.resourceId); } catch (e: any) {
        console.warn(`[infra] Rollback telnyx failed: ${e.message}`);
      }
    }
    throw err;
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

  console.log(`[infra] Instance ${instanceId} created successfully`);
  return { instanceId, serviceId, url, services };
}

/**
 * Destroy an instance and all its resources.
 */
export async function destroyInstance(instanceId: string): Promise<DestroyResult> {
  const infraRows = await db.select().from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
  const infra = infraRows[0];
  if (!infra) throw Object.assign(new Error(`Instance ${instanceId} not found`), { status: 404 });

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
  return { instanceId, destroyed };
}
