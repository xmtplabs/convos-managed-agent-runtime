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
 * Create a new instance: own Railway project + service + tools + DB rows.
 */
export async function createInstance(
  instanceId: string,
  name: string,
  tools: string[] = ["openrouter", "agentmail"],
): Promise<CreateInstanceResponse> {
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

  // ── Sharded: create a dedicated Railway project for this instance ──
  if (!config.railwayTeamId) throw new Error("RAILWAY_TEAM_ID not set — required for instance creation");

  const proj = await railway.projectCreate(`agent-${instanceId}`);
  const projectId = proj.projectId;

  let environmentId: string;
  try {
    environmentId = await railway.getProjectEnvironmentId(projectId);
  } catch (err) {
    console.error(`[infra] Failed to resolve env for project ${projectId}, deleting orphan project...`);
    await railway.projectDelete(projectId).catch((e: any) =>
      console.warn(`[infra] Orphan project cleanup failed: ${e.message}`));
    throw err;
  }

  const opts = { projectId, environmentId };

  // Create Railway service in the new project
  let serviceId: string;
  try {
    serviceId = await railway.createService(name, vars, opts);
    console.log(`[infra] Railway service created: ${serviceId}`);
  } catch (err) {
    console.error(`[infra] Service creation failed, deleting orphan project ${projectId}...`);
    await railway.projectDelete(projectId).catch((e: any) =>
      console.warn(`[infra] Orphan project cleanup failed: ${e.message}`));
    throw err;
  }

  // Create volume
  let hasVolume = false;
  try {
    hasVolume = await railway.ensureVolume(serviceId, "/data", opts);
    if (!hasVolume) console.warn(`[infra] Volume creation failed for ${serviceId}`);
  } catch (err) {
    console.error(`[infra] Volume failed, deleting orphan project ${projectId}...`);
    await railway.projectDelete(projectId).catch((e: any) =>
      console.warn(`[infra] Orphan project cleanup failed: ${e.message}`));
    throw err;
  }

  // Create domain
  let url: string | null = null;
  try {
    const domain = await railway.createDomain(serviceId, opts);
    url = `https://${domain}`;
    console.log(`[infra] Domain: ${url}`);
  } catch (err: any) {
    console.warn(`[infra] Domain creation failed for ${serviceId}: ${err.message}`);
    // Non-fatal — continue without domain
  }

  // Insert into instance_infra
  await db.insert(instanceInfra).values({
    instanceId,
    provider: "railway",
    providerServiceId: serviceId,
    providerEnvId: environmentId,
    providerProjectId: projectId,
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

  console.log(`[infra] Instance ${instanceId} created successfully (project=${projectId})`);
  return { instanceId, serviceId, url, services };
}

/**
 * Destroy an instance and all its resources.
 * Instances with providerProjectId → projectDelete cascades service + volumes.
 * Old DB rows without providerProjectId → service-level cleanup fallback.
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

  // Delete tool resources (always — not managed by Railway project)
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

  if (infra.providerProjectId) {
    // Sharded: delete the entire project (cascades service + volumes)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await railway.projectDelete(infra.providerProjectId);
        destroyed.service = true;
        destroyed.volumes = true;
        break;
      } catch (err: any) {
        console.warn(`[infra] projectDelete attempt ${attempt}/3 for ${infra.providerProjectId}: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  } else {
    // Fallback: no project ID on record — delete service directly
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await railway.deleteService(infra.providerServiceId);
        destroyed.service = true;
        break;
      } catch (err: any) {
        console.warn(`[infra] deleteService attempt ${attempt}/3 for ${infra.providerServiceId}: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }

  // Delete DB rows (cascade handles instance_services)
  await db.delete(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));

  console.log(`[infra] Instance ${instanceId} destroyed`);
  return { instanceId, destroyed };
}
