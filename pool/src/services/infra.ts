import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { instanceInfra, instanceServices } from "../db/schema";
import * as railway from "./providers/railway";
import * as openrouter from "./providers/openrouter";
import * as exa from "./providers/exa";
import * as agentmail from "./providers/agentmail";
import * as telnyx from "./providers/telnyx";
import * as wallet from "./providers/wallet";
import { buildInstanceEnv } from "./providers/env";
import { config } from "../config";
import { metricCount, metricHistogram } from "../metrics";
import { logger, classifyError } from "../logger";
import type { CreateInstanceResponse, DestroyResult } from "../types";

export type ProgressCallback = (step: string, status: string, message?: string) => void;

/**
 * Create a new instance: own Railway project + service + OpenRouter key + DB rows.
 * Email (AgentMail) and SMS (Telnyx) are provisioned on demand at first use
 * via the proxy provision endpoints — not at creation time.
 */
export async function createInstance(
  instanceId: string,
  name: string,
  tools: string[] = ["openrouter"],
  onProgress?: ProgressCallback,
  runtimeImage?: string,
  model?: string,
): Promise<CreateInstanceResponse> {
  // Generate secrets
  const gatewayToken = wallet.generateGatewayToken();

  // Build env vars
  const vars: Record<string, string> = { ...buildInstanceEnv() };
  vars.INSTANCE_ID = instanceId;
  vars.GATEWAY_TOKEN = gatewayToken;
  vars.OPENCLAW_GATEWAY_TOKEN = gatewayToken; // backward compat with old runtime images

  // Provision OpenRouter key
  const services: CreateInstanceResponse["services"] = {};

  try {
    if (tools.includes("openrouter") && config.openrouterManagementKey) {
      onProgress?.("openrouter", "active");
      const t0 = Date.now();
      const keyName = `assistant-${config.poolEnvironment}-${instanceId}`;
      const { key, hash } = await openrouter.createKey(keyName);
      metricHistogram("provider.openrouter.duration_ms", Date.now() - t0, { step: "create_key" });
      metricCount("provider.openrouter.provisioned");
      vars.OPENROUTER_API_KEY = key;
      services.openrouter = { resourceId: hash };
      onProgress?.("openrouter", "ok");
    } else {
      onProgress?.("openrouter", "skip", "Not configured");
    }
  } catch (err) {
    const { error_class, error_message } = classifyError(err);

    console.error(`[infra] Provisioning failed for ${instanceId}, rolling back...`);
    logger.error("create.provider_fail", {
      instanceId,
      failed_step: "openrouter",
      error_class,
      error_message: error_message.slice(0, 1500),
      provisioned: Object.keys(services),
    });

    metricCount("instance.create.fail", 1, { phase: "provider", provider: "openrouter", error_class });
    metricCount("provider.rollback", 1, { failed_step: "openrouter" });

    onProgress?.("openrouter", "fail", (err as Error).message);
    throw err;
  }

  // Provision Exa key (web search + extract)
  try {
    if (config.exaServiceKey) {
      onProgress?.("exa", "active");
      const t0 = Date.now();
      const keyName = `assistant-${config.poolEnvironment}-${instanceId}`;
      const { id } = await exa.createKey(keyName, config.exaKeyRateLimit);
      metricHistogram("provider.exa.duration_ms", Date.now() - t0, { step: "create_key" });
      metricCount("provider.exa.provisioned");
      vars.EXA_API_KEY = id;
      services.exa = { resourceId: id };
      onProgress?.("exa", "ok");
    } else {
      onProgress?.("exa", "skip", "Not configured");
    }
  } catch (err) {
    // Exa is non-fatal — instance can function without web tools
    const { error_class, error_message } = classifyError(err);
    console.warn(`[infra] Exa key provisioning failed for ${instanceId} (non-fatal):`, (err as Error).message);
    logger.warn("create.provider_warn", {
      instanceId,
      failed_step: "exa",
      error_class,
      error_message: error_message.slice(0, 1500),
    });
    metricCount("provider.exa.fail", 1, { error_class });
    onProgress?.("exa", "fail", (err as Error).message);
  }

  // ── Sharded: create a dedicated Railway project for this instance ──
  if (!config.railwayTeamId) throw new Error("RAILWAY_TEAM_ID not set — required for instance creation");

  onProgress?.("railway-project", "active");
  let projectId: string;
  try {
    const projStart = Date.now();
    const envTag = config.poolEnvironment === "production" ? "prod" : config.poolEnvironment;
    const proj = await railway.projectCreate(`assistant-${envTag}-${instanceId}`);
    projectId = proj.projectId;
    metricHistogram("provider.railway.project.duration_ms", Date.now() - projStart);
    metricCount("provider.railway.project.provisioned");
  } catch (err) {
    const { error_class, error_message } = classifyError(err);
    console.error(`[infra] Railway project creation failed for ${instanceId}:`, (err as Error).message);
    logger.error("create.railway_project_fail", { instanceId, error_class, error_message: error_message.slice(0, 1500) });
    metricCount("instance.create.fail", 1, { phase: "railway_project", error_class });
    onProgress?.("railway-project", "fail", (err as Error).message);
    if (services.openrouter) {
      await openrouter.deleteKey(services.openrouter.resourceId).catch((e: any) =>
        logger.warn("create.rollback_fail", { instanceId, tool: "openrouter", error_message: e.message?.slice(0, 1500) }));
    }
    if (services.exa) {
      await exa.deleteKey(services.exa.resourceId).catch((e: any) =>
        logger.warn("create.rollback_fail", { instanceId, tool: "exa", error_message: e.message?.slice(0, 1500) }));
    }
    throw err;
  }
  onProgress?.("railway-project", "ok", projectId);

  let environmentId: string;
  try {
    environmentId = await railway.getProjectEnvironmentId(projectId);
  } catch (err) {
    const { error_class, error_message } = classifyError(err);
    console.error(`[infra] Failed to resolve env for project ${projectId}, deleting orphan project...`);
    logger.error("create.railway_env_fail", { instanceId, projectId, error_class, error_message: error_message.slice(0, 1500) });
    metricCount("instance.create.fail", 1, { phase: "railway_env", error_class });
    await railway.projectDelete(projectId).catch((e: any) => {
      console.warn(`[infra] Orphan project cleanup failed: ${e.message}`);
      logger.warn("create.orphan_cleanup_fail", { instanceId, projectId, error_message: e.message?.slice(0, 1500) });
    });
    if (services.openrouter) {
      await openrouter.deleteKey(services.openrouter.resourceId).catch((e: any) =>
        logger.warn("create.rollback_fail", { instanceId, tool: "openrouter", error_message: e.message?.slice(0, 1500) }));
    }
    if (services.exa) {
      await exa.deleteKey(services.exa.resourceId).catch((e: any) =>
        logger.warn("create.rollback_fail", { instanceId, tool: "exa", error_message: e.message?.slice(0, 1500) }));
    }
    throw err;
  }

  const opts = { projectId, environmentId };

  // Create Railway service + volume + domain in the new project
  // Domain is created inside createService before the first deploy triggers,
  // so RAILWAY_PUBLIC_DOMAIN is injected on boot.
  onProgress?.("railway-service", "active");
  let serviceId: string;
  let url: string | null = null;
  try {
    const svcStart = Date.now();
    const result = await railway.createService(name, vars, opts, runtimeImage);
    serviceId = result.serviceId;
    if (result.domain) url = `https://${result.domain}`;
    metricHistogram("provider.railway.service.duration_ms", Date.now() - svcStart);
    console.log(`[infra] Railway service created: ${serviceId}`);
  } catch (err) {
    const { error_class, error_message } = classifyError(err);
    console.error(`[infra] Service creation failed, deleting orphan project ${projectId}...`);
    logger.error("create.railway_service_fail", { instanceId, projectId, error_class, error_message: error_message.slice(0, 1500) });
    metricCount("instance.create.fail", 1, { phase: "railway_service", error_class });
    onProgress?.("railway-service", "fail", (err as Error).message);
    await railway.projectDelete(projectId).catch((e: any) => {
      console.warn(`[infra] Orphan project cleanup failed: ${e.message}`);
      logger.warn("create.orphan_cleanup_fail", { instanceId, projectId, error_message: e.message?.slice(0, 1500) });
    });
    if (services.openrouter) {
      await openrouter.deleteKey(services.openrouter.resourceId).catch((e: any) =>
        logger.warn("create.rollback_fail", { instanceId, tool: "openrouter", error_message: e.message?.slice(0, 1500) }));
    }
    if (services.exa) {
      await exa.deleteKey(services.exa.resourceId).catch((e: any) =>
        logger.warn("create.rollback_fail", { instanceId, tool: "exa", error_message: e.message?.slice(0, 1500) }));
    }
    throw err;
  }

  onProgress?.("railway-service", "ok", serviceId);
  if (url) {
    onProgress?.("railway-domain", "ok", url);
    console.log(`[infra] Domain: ${url}`);
  } else {
    onProgress?.("railway-domain", "fail", "domain not created");
  }

  // Insert into instance_infra + instance_services — if DB fails, clean up
  // the Railway project and OpenRouter key we just created.
  try {
    await db.insert(instanceInfra).values({
      instanceId,
      provider: "railway",
      providerServiceId: serviceId,
      providerEnvId: environmentId,
      providerProjectId: projectId,
      url,
      deployStatus: "BUILDING",
      runtimeImage: runtimeImage || config.railwayRuntimeImage,
      gatewayToken,
    });

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

    if (services.exa) {
      await db.insert(instanceServices).values({
        instanceId,
        toolId: "exa",
        resourceId: services.exa.resourceId,
        envKey: "EXA_API_KEY",
        envValue: vars.EXA_API_KEY,
      });
    }
  } catch (err) {
    const { error_class, error_message } = classifyError(err);
    logger.error("create.db_insert_fail", {
      instanceId, projectId, error_class, error_message: error_message.slice(0, 1500),
      provisioned: Object.keys(services),
    });
    metricCount("instance.create.fail", 1, { phase: "db", error_class });
    onProgress?.("db", "fail", (err as Error).message);

    // Best-effort cleanup of already-provisioned resources
    await db.delete(instanceInfra).where(eq(instanceInfra.instanceId, instanceId)).catch((e: any) =>
      logger.warn("create.orphan_db_cleanup_fail", { instanceId, error_message: e.message?.slice(0, 1500) }));
    await railway.projectDelete(projectId).catch((e: any) =>
      logger.warn("create.orphan_cleanup_fail", { instanceId, projectId, error_message: e.message?.slice(0, 1500) }));
    if (services.openrouter) {
      await openrouter.deleteKey(services.openrouter.resourceId).catch((e: any) =>
        logger.warn("create.rollback_fail", { instanceId, tool: "openrouter", error_message: e.message?.slice(0, 1500) }));
    }
    if (services.exa) {
      await exa.deleteKey(services.exa.resourceId).catch((e: any) =>
        logger.warn("create.rollback_fail", { instanceId, tool: "exa", error_message: e.message?.slice(0, 1500) }));
    }
    throw err;
  }

  onProgress?.("done", "ok");

  console.log(`[infra] Instance ${instanceId} created successfully (project=${projectId})`);
  return { instanceId, serviceId, url, services };
}

/**
 * Destroy an instance and all its resources.
 * Instances with providerProjectId → projectDelete cascades service + volumes.
 * Old DB rows without providerProjectId → service-level cleanup fallback.
 *
 * Note: agentmail/telnyx resources may exist if provisioned on-demand during
 * the instance's lifetime — destroy still cleans them up from instance_services rows.
 */
export async function destroyInstance(instanceId: string, onProgress?: ProgressCallback): Promise<DestroyResult> {
  const infraRows = await db.select().from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
  const infra = infraRows[0];
  if (!infra) throw Object.assign(new Error(`Instance ${instanceId} not found`), { status: 404 });

  const svcRows = await db.select().from(instanceServices).where(eq(instanceServices.instanceId, instanceId));

  const destroyed: DestroyResult["destroyed"] = {
    openrouter: false,
    exa: false,
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
      } else if (svc.toolId === "exa") {
        onProgress?.("exa", "active");
        destroyed.exa = await exa.deleteKey(svc.resourceId);
        onProgress?.("exa", destroyed.exa ? "ok" : "skip", destroyed.exa ? undefined : "No key found");
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
  if (!svcToolIds.has("exa")) onProgress?.("exa", "skip", "Not provisioned");
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
