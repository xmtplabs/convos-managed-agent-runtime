import * as db from "./db/pool";
import { healthCheck } from "./pool";
import { authFetch } from "./authFetch";
import { config } from "./config";
import { metricCount, metricHistogram } from "./metrics";
import { logger } from "./logger";
import { gql } from "./services/providers/railway";
import { decideAction } from "./webhookLogic";
import { parseRuntimeStatus } from "./runtimeStatus";

export { decideAction } from "./webhookLogic";
export type { WebhookAction, WebhookDecision } from "./webhookLogic";

// ── Webhook handler ────────────────────────────────────────────────────────

const HEALTH_CHECK_INITIAL_DELAY_MS = 30_000;
const HEALTH_CHECK_RETRIES = 6;
const HEALTH_CHECK_INTERVAL_MS = 15_000;

interface RailwayWebhookPayload {
  type: string;
  resource?: {
    service?: { id: string };
    environment?: { id: string };
  };
  details?: {
    status?: string;
  };
}

/**
 * Process a Railway webhook event. Called async after responding 200.
 * Returns true if the event matched a known instance, false if ignored.
 */
export async function handleRailwayWebhook(payload: RailwayWebhookPayload): Promise<boolean> {
  if (!payload) {
    console.log("[webhook] Ignoring event: no payload");
    return false;
  }
  const eventType = payload.type;
  const serviceId = payload.resource?.service?.id;

  if (!serviceId) {
    console.log(`[webhook] Ignoring event ${eventType}: no service ID`);
    return false;
  }

  // Look up instance by Railway service ID
  const infra = await db.findByServiceId(serviceId);
  if (!infra) {
    // Not our instance (pool manager itself, or non-instance service)
    return false;
  }

  const { instanceId } = infra;
  const instance = await db.findById(instanceId);
  if (!instance) {
    console.warn(`[webhook] Instance ${instanceId} in infra but not in instances table`);
    return false;
  }

  // Verify environment matches (workspace webhooks fire for all envs)
  const webhookEnvId = payload.resource?.environment?.id;
  if (webhookEnvId && webhookEnvId !== infra.providerEnvId) {
    return false; // Event from a different environment — ignore
  }

  const isClaimed = !!instance.agentName || instance.status === "claimed";
  const decision = decideAction(eventType, instance.status, isClaimed);

  console.log(`[webhook] ${eventType} → instance=${instanceId} status=${instance.status} claimed=${isClaimed} → action=${decision.action}${decision.newStatus ? ` newStatus=${decision.newStatus}` : ""}`);

  // Sync deploy status from the event to infra table
  const deployStatusMap: Record<string, string> = {
    "Deployment.deployed": "SUCCESS",
    "Deployment.crashed": "CRASHED",
    "Deployment.failed": "FAILED",
    "Deployment.oom_killed": "CRASHED",
    "Deployment.slept": "SLEEPING",
    "Deployment.resumed": "SUCCESS",
  };
  const deployStatus = deployStatusMap[eventType];
  if (deployStatus) {
    await db.updateDeployStatus(instanceId, deployStatus).catch((err) =>
      console.warn(`[webhook] Failed to update deploy status for ${instanceId}: ${err.message}`));
  }

  switch (decision.action) {
    case "set_status": {
      // Conditional update: never overwrite 'claiming' status (atomic claim in progress)
      const updated = await db.conditionalUpdateStatus(instanceId, decision.newStatus!, instance.status);
      if (updated) {
        metricCount("webhook.state_change", 1, { from: instance.status, to: decision.newStatus });
        // Starting instance dying = failed create lifecycle
        if (instance.status === "starting" && decision.newStatus === "dead") {
          metricCount("instance.create.fail", 1, { phase: "deploy" });
          metricHistogram("instance.create.duration_ms", Date.now() - new Date(instance.createdAt).getTime());
        }
        console.log(`[webhook] ${instanceId}: ${instance.status} → ${decision.newStatus}`);
      } else {
        console.log(`[webhook] ${instanceId}: conditional update skipped (status may have changed)`);
      }
      break;
    }

    case "health_check": {
      const url = instance.url || infra.url;
      if (!url) {
        console.warn(`[webhook] ${instanceId}: no URL available for health check, skipping`);
        break;
      }
      // Run health check with retries, async (don't block)
      runHealthCheckWithRetries(instanceId, url, instance.status).catch((err) =>
        console.error(`[webhook] Health check failed for ${instanceId}: ${err.message}`));
      break;
    }

    case "noop":
      break;
  }

  return true;
}

/**
 * Health check with retries for deployed/resumed events.
 * Uses conditional update to avoid overwriting concurrent claims.
 */
async function runHealthCheckWithRetries(
  instanceId: string,
  url: string,
  statusAtWebhookTime: string,
): Promise<void> {
  // Wait for the runtime container to boot before polling
  await new Promise((r) => setTimeout(r, HEALTH_CHECK_INITIAL_DELAY_MS));

  for (let attempt = 1; attempt <= HEALTH_CHECK_RETRIES; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
    }

    const instToken = await db.getGatewayToken(instanceId);
    const hc = await healthCheck(url, instToken);
    if (hc?.ready) {
      // Ask the runtime whether it has an active conversation
      let runtimeConvoId: string | null = null;
      let runtimeReusable: boolean | null = null;
      let runtimeDirtyReasons: string[] = [];
      let statusKnown = false;
      try {
        const csRes = await authFetch(`${url}/convos/status`, {
          gatewayToken: instToken,
          signal: AbortSignal.timeout(5000),
        });
        if (csRes.ok) {
          const cs = parseRuntimeStatus(await csRes.json());
          runtimeConvoId = cs.conversationId;
          runtimeReusable = cs.reusable;
          runtimeDirtyReasons = cs.dirtyReasons;
          statusKnown = true;
        }
      } catch {}

      if (!statusKnown) {
        console.warn(`[webhook] ${instanceId}: /convos/status failed, leaving as ${statusAtWebhookTime}`);
        return;
      }

      let updated: boolean;
      let newStatus: string;
      if (runtimeConvoId) {
        // Verify the conversation matches what we provisioned
        const inst = await db.findById(instanceId);
        if (inst?.conversationId && inst.conversationId === runtimeConvoId) {
          newStatus = "claimed";
          updated = await db.conditionalUpdateStatus(instanceId, "claimed", statusAtWebhookTime);
        } else {
          // Stuck provision failure or mismatch — don't promote
          console.log(`[webhook] ${instanceId}: runtime has conversation ${runtimeConvoId} but DB has ${inst?.conversationId || "none"} — leaving as ${statusAtWebhookTime}`);
          return;
        }
      } else if (runtimeReusable === true) {
        newStatus = "idle";
        updated = await db.recoverToIdle(instanceId, statusAtWebhookTime);
      } else {
        console.log(`[webhook] ${instanceId}: runtime reported no conversation but reusable=${runtimeReusable} dirty=${runtimeDirtyReasons.join(",") || "unknown"} — leaving as ${statusAtWebhookTime}`);
        return;
      }
      if (!updated) {
        console.log(`[webhook] ${instanceId}: conditional promotion skipped (status changed from ${statusAtWebhookTime})`);
        return;
      }
      if (hc.version) await db.setRuntimeVersion(instanceId, hc.version);
      metricCount("webhook.health_check_promoted", 1, { from: statusAtWebhookTime, to: newStatus });
      // Starting instance promoted = completed create lifecycle
      if (statusAtWebhookTime === "starting") {
        const inst = await db.findById(instanceId);
        if (inst) {
          const durationMs = Date.now() - new Date(inst.createdAt).getTime();
          metricCount("instance.create.complete");
          metricHistogram("instance.create.duration_ms", durationMs);
          logger.info("create.complete", { instanceId, name: inst.name, duration_ms: durationMs });
        }
      }
      console.log(`[webhook] ${instanceId}: health check passed (attempt ${attempt}), ${statusAtWebhookTime} → ${newStatus} (v${hc.version || "?"})`);
      return;
    }
  }

  console.warn(`[webhook] ${instanceId}: health check failed after ${HEALTH_CHECK_RETRIES} attempts, leaving status as ${statusAtWebhookTime}`);
}

// ── Auto-register webhook rule ─────────────────────────────────────────────

const WEBHOOK_EVENT_TYPES = [
  "Deployment.deployed",
  "Deployment.crashed",
  "Deployment.failed",
  "Deployment.oom_killed",
  "Deployment.slept",
  "Deployment.resumed",
];

interface NotificationRuleRow {
  id: string;
  eventTypes: string[];
  channels: { id: string; config: unknown }[];
}

/**
 * List all notification rules for the workspace, then return only those
 * whose channel config contains a webhook URL matching ours.
 */
async function findMatchingWebhookRules(webhookUrl: string): Promise<NotificationRuleRow[]> {
  const data = await gql(
    `query($workspaceId: String!) {
      notificationRules(workspaceId: $workspaceId) { id eventTypes channels { id config } }
    }`,
    { workspaceId: config.railwayTeamId },
  );

  const rules: NotificationRuleRow[] = data.notificationRules ?? [];
  return rules.filter((r) =>
    r.channels?.some((ch) => {
      const cfg = ch.config as any;
      const type = cfg?.type?.toLowerCase();
      const url = cfg?.url || cfg?.webhookUrl;
      return type === "webhook" && url === webhookUrl;
    }),
  );
}

/**
 * Ensure a Railway notification rule exists to deliver webhook events to
 * this pool manager. Queries existing rules first to avoid creating duplicates.
 */
export async function ensureWebhookRule(): Promise<void> {
  if (!config.poolUrl || !config.poolApiKey || !config.railwayApiToken || !config.railwayTeamId) {
    console.log("[webhook] Skipping webhook registration: missing POOL_URL, POOL_API_KEY, RAILWAY_API_TOKEN, or RAILWAY_TEAM_ID");
    return;
  }

  const webhookUrl = `${config.poolUrl}/webhooks/railway/${config.poolApiKey}`;

  // ── Check for existing matching rules ────────────────────────────────────
  let existing: NotificationRuleRow[] = [];
  try {
    existing = await findMatchingWebhookRules(webhookUrl);
  } catch (err: any) {
    console.warn(`[webhook] Failed to query existing rules, will attempt create: ${err.message}`);
  }

  // ── Already have a matching rule — skip creation ─────────────────────────
  const match = existing.find((r) =>
    WEBHOOK_EVENT_TYPES.every((t) => r.eventTypes.includes(t)),
  );
  if (match) {
    console.log(`[webhook] Webhook rule already exists (${match.id}) → ${config.poolUrl}/webhooks/railway/***`);
    return;
  }

  // ── Create new rule ──────────────────────────────────────────────────────
  try {
    const data = await gql(
      `mutation($input: CreateNotificationRuleInput!) {
        notificationRuleCreate(input: $input) { id }
      }`,
      {
        input: {
          workspaceId: config.railwayTeamId,
          eventTypes: WEBHOOK_EVENT_TYPES,
          channelConfigs: [{ type: "webhook", url: webhookUrl }],
        },
      },
    );
    console.log(`[webhook] Webhook rule created (${data.notificationRuleCreate.id}) for ${WEBHOOK_EVENT_TYPES.length} event types → ${config.poolUrl}/webhooks/railway/***`);
  } catch (err: any) {
    console.warn(`[webhook] Failed to register webhook rule: ${err.message}`);
  }
}
