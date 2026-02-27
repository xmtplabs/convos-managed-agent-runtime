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
import { sendMetric } from "../metrics";
import type { CreateInstanceResponse, DestroyResult } from "../types";

export type ProgressCallback = (step: string, status: string, message?: string) => void;

/**
 * Create a new instance: own Railway project + service + tools + DB rows.
 */
export async function createInstance(
  instanceId: string,
  name: string,
  tools: string[] = ["openrouter", "agentmail"],
  onProgress?: ProgressCallback,
): Promise<CreateInstanceResponse> {
  // Generate secrets
  const gatewayToken = wallet.generateGatewayToken();
  const setupPassword = wallet.generateSetupPassword();
  const walletKey = wallet.generatePrivateWalletKey();

  // Build env vars
  const vars: Record<string, string> = { ...buildInstanceEnv() };
  vars.INSTANCE_ID = instanceId;
  vars.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  vars.SETUP_PASSWORD = setupPassword;
  vars.PRIVATE_WALLET_KEY = walletKey;

  // Provision requested tools (rollback on failure to avoid leaked resources)
  const services: CreateInstanceResponse["services"] = {};

  try {
    // Telnyx first — it has the most contention (rate limits + race conditions)
    if (tools.includes("telnyx") && config.telnyxApiKey) {
      onProgress?.("telnyx", "active");
      const t0 = Date.now();
      const { phoneNumber, messagingProfileId } = await telnyx.provisionPhone();
      sendMetric("provider.telnyx.duration_ms", Date.now() - t0, { step: "provision_phone" });
      sendMetric("provider.telnyx.provisioned", 1);
      vars.TELNYX_PHONE_NUMBER = phoneNumber;
      vars.TELNYX_MESSAGING_PROFILE_ID = messagingProfileId;
      services.telnyx = { resourceId: phoneNumber };
      onProgress?.("telnyx", "ok");
    } else {
      onProgress?.("telnyx", "skip", "Not configured");
    }

    if (tools.includes("openrouter") && config.openrouterManagementKey) {
      onProgress?.("openrouter", "active");
      const t0 = Date.now();
      const keyName = `convos-agent-${instanceId}`;
      const { key, hash } = await openrouter.createKey(keyName);
      sendMetric("provider.openrouter.duration_ms", Date.now() - t0, { step: "create_key" });
      sendMetric("provider.openrouter.provisioned", 1);
      vars.OPENROUTER_API_KEY = key;
      services.openrouter = { resourceId: hash };
      onProgress?.("openrouter", "ok");
    } else {
      onProgress?.("openrouter", "skip", "Not configured");
    }

    if (tools.includes("agentmail") && config.agentmailApiKey) {
      onProgress?.("agentmail", "active");
      const t0 = Date.now();
      const inboxId = await agentmail.createInbox(instanceId);
      sendMetric("provider.agentmail.duration_ms", Date.now() - t0, { step: "create_inbox" });
      sendMetric("provider.agentmail.provisioned", 1);
      vars.AGENTMAIL_INBOX_ID = inboxId;
      services.agentmail = { resourceId: inboxId };
      onProgress?.("agentmail", "ok");
    } else {
      onProgress?.("agentmail", "skip", "Not configured");
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
    // Determine which tool was being provisioned when it failed:
    // the last tool that got "active" but never got "ok"
    const failedStep = !services.telnyx && tools.includes("telnyx") && config.telnyxApiKey ? "telnyx"
      : !services.openrouter && tools.includes("openrouter") && config.openrouterManagementKey ? "openrouter"
      : !services.agentmail && tools.includes("agentmail") && config.agentmailApiKey ? "agentmail"
      : "unknown";
    sendMetric("provider.rollback", 1, { failed_step: failedStep });
    onProgress?.(failedStep, "fail", (err as Error).message);
    throw err;
  }

  // ── Sharded: create a dedicated Railway project for this instance ──
  if (!config.railwayTeamId) throw new Error("RAILWAY_TEAM_ID not set — required for instance creation");

  onProgress?.("railway-project", "active");
  const projStart = Date.now();
  const proj = await railway.projectCreate(`convos-agent-${instanceId}`);
  const projectId = proj.projectId;
  sendMetric("provider.railway.project.duration_ms", Date.now() - projStart);
  sendMetric("provider.railway.provisioned", 1);
  onProgress?.("railway-project", "ok", projectId);

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

  // Create Railway service + volume in the new project
  onProgress?.("railway-service", "active");
  let serviceId: string;
  try {
    const svcStart = Date.now();
    serviceId = await railway.createService(name, vars, opts);
    sendMetric("provider.railway.service.duration_ms", Date.now() - svcStart);
    console.log(`[infra] Railway service created: ${serviceId}`);
  } catch (err) {
    onProgress?.("railway-service", "fail", (err as Error).message);
    console.error(`[infra] Service creation failed, deleting orphan project ${projectId}...`);
    await railway.projectDelete(projectId).catch((e: any) =>
      console.warn(`[infra] Orphan project cleanup failed: ${e.message}`));
    throw err;
  }

  // Attach volume to service
  let hasVolume = false;
  try {
    hasVolume = await railway.ensureVolume(serviceId, "/data", opts);
    if (!hasVolume) {
      console.warn(`[infra] Volume creation failed for ${serviceId}`);
    }
  } catch (err) {
    onProgress?.("railway-service", "fail", (err as Error).message);
    console.error(`[infra] Volume failed, deleting orphan project ${projectId}...`);
    await railway.projectDelete(projectId).catch((e: any) =>
      console.warn(`[infra] Orphan project cleanup failed: ${e.message}`));
    throw err;
  }
  onProgress?.("railway-service", "ok");

  // Create domain
  onProgress?.("railway-domain", "active");
  let url: string | null = null;
  try {
    const domainStart = Date.now();
    const domain = await railway.createDomain(serviceId, opts);
    sendMetric("provider.railway.domain.duration_ms", Date.now() - domainStart);
    url = `https://${domain}`;
    console.log(`[infra] Domain: ${url}`);
    onProgress?.("railway-domain", "ok");
  } catch (err: any) {
    console.warn(`[infra] Domain creation failed for ${serviceId}: ${err.message}`);
    onProgress?.("railway-domain", "fail", err.message);
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
    gatewayToken,
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

  onProgress?.("done", "ok");

  console.log(`[infra] Instance ${instanceId} created successfully (project=${projectId})`);
  return { instanceId, serviceId, url, services };
}

/**
 * Destroy an instance and all its resources.
 * Instances with providerProjectId → projectDelete cascades service + volumes.
 * Old DB rows without providerProjectId → service-level cleanup fallback.
 */
export async function destroyInstance(instanceId: string, onProgress?: ProgressCallback): Promise<DestroyResult> {
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
        onProgress?.("openrouter", "active");
        destroyed.openrouter = await openrouter.deleteKey(svc.resourceId);
        onProgress?.("openrouter", destroyed.openrouter ? "ok" : "skip", destroyed.openrouter ? undefined : "No key found");
      } else if (svc.toolId === "agentmail") {
        onProgress?.("agentmail", "active");
        destroyed.agentmail = await agentmail.deleteInbox(svc.resourceId);
        onProgress?.("agentmail", destroyed.agentmail ? "ok" : "skip", destroyed.agentmail ? undefined : "No inbox found");
      } else if (svc.toolId === "telnyx") {
        onProgress?.("telnyx", "active");
        destroyed.telnyx = await telnyx.deletePhone(svc.resourceId);
        onProgress?.("telnyx", destroyed.telnyx ? "ok" : "skip", destroyed.telnyx ? undefined : "No phone found");
      }
    } catch (err: any) {
      console.warn(`[infra] Failed to delete ${svc.toolId} resource for ${instanceId}:`, err.message);
      onProgress?.(svc.toolId, "fail", err.message);
    }
  }

  // Report skip for tools that had no service rows
  const svcToolIds = new Set(svcRows.map((s) => s.toolId));
  if (!svcToolIds.has("openrouter")) onProgress?.("openrouter", "skip", "Not provisioned");
  if (!svcToolIds.has("agentmail")) onProgress?.("agentmail", "skip", "Not provisioned");
  if (!svcToolIds.has("telnyx")) onProgress?.("telnyx", "skip", "Not provisioned");

  onProgress?.("railway", "active");
  if (infra.providerProjectId) {
    // Sharded: delete the entire project (cascades service + volumes)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await railway.projectDelete(infra.providerProjectId);
        destroyed.service = true;
        destroyed.volumes = true;
        onProgress?.("railway", "ok");
        break;
      } catch (err: any) {
        console.warn(`[infra] projectDelete attempt ${attempt}/3 for ${infra.providerProjectId}: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
        else onProgress?.("railway", "fail", err.message);
      }
    }
  } else {
    // Fallback: no project ID on record — delete service directly
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await railway.deleteService(infra.providerServiceId);
        destroyed.service = true;
        onProgress?.("railway", "ok");
        break;
      } catch (err: any) {
        console.warn(`[infra] deleteService attempt ${attempt}/3 for ${infra.providerServiceId}: ${err.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
        else onProgress?.("railway", "fail", err.message);
      }
    }
  }

  // Delete DB rows (cascade handles instance_services)
  onProgress?.("db", "active");
  await db.delete(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
  onProgress?.("db", "ok");

  console.log(`[infra] Instance ${instanceId} destroyed`);
  return { instanceId, destroyed };
}
