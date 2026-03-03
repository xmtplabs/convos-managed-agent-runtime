import * as db from "./db/pool";
import { healthCheck } from "./pool";
import { config } from "./config";
import { sendMetric } from "./metrics";
import { gql } from "./services/providers/railway";
import { decideAction } from "./webhookLogic";

export { decideAction } from "./webhookLogic";
export type { WebhookAction, WebhookDecision } from "./webhookLogic";

// ── Webhook handler ────────────────────────────────────────────────────────

const HEALTH_CHECK_RETRIES = 5;
const HEALTH_CHECK_INTERVAL_MS = 3000;

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
 */
export async function handleRailwayWebhook(payload: RailwayWebhookPayload): Promise<void> {
  const eventType = payload.type;
  const serviceId = payload.resource?.service?.id;

  if (!serviceId) {
    console.log(`[webhook] Ignoring event ${eventType}: no service ID`);
    return;
  }

  // Look up instance by Railway service ID
  const infra = await db.findByServiceId(serviceId);
  if (!infra) {
    // Not our instance (pool manager itself, or non-instance service)
    return;
  }

  const { instanceId } = infra;
  const instance = await db.findById(instanceId);
  if (!instance) {
    console.warn(`[webhook] Instance ${instanceId} in infra but not in instances table`);
    return;
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
      await db.updateStatus(instanceId, { status: decision.newStatus! });
      sendMetric("webhook.state_change", 1, { from: instance.status, to: decision.newStatus });
      console.log(`[webhook] ${instanceId}: ${instance.status} → ${decision.newStatus}`);
      break;
    }

    case "health_check": {
      // Run health check with retries, async (don't block)
      runHealthCheckWithRetries(instanceId, instance.url!, instance.status, isClaimed).catch((err) =>
        console.error(`[webhook] Health check failed for ${instanceId}: ${err.message}`));
      break;
    }

    case "noop":
      break;
  }
}

/**
 * Health check with retries for deployed/resumed events.
 * Uses conditional update to avoid overwriting concurrent claims.
 */
async function runHealthCheckWithRetries(
  instanceId: string,
  url: string,
  statusAtWebhookTime: string,
  isClaimed: boolean,
): Promise<void> {
  for (let attempt = 1; attempt <= HEALTH_CHECK_RETRIES; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
    }

    const hc = await healthCheck(url);
    if (hc?.ready) {
      // Conditional update: only write if status hasn't changed since webhook arrived
      const current = await db.findById(instanceId);
      if (!current || current.status !== statusAtWebhookTime) {
        console.log(`[webhook] ${instanceId}: status changed (${statusAtWebhookTime} → ${current?.status}), skipping promotion`);
        return;
      }

      const newStatus = isClaimed ? "claimed" : "idle";
      await db.updateStatus(instanceId, { status: newStatus });
      if (hc.version) await db.setRuntimeVersion(instanceId, hc.version);
      sendMetric("webhook.health_check_promoted", 1, { from: statusAtWebhookTime, to: newStatus });
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

/**
 * Register a Railway notification rule to deliver webhook events to this pool manager.
 * Skips gracefully if required env vars are not set.
 */
export async function ensureWebhookRule(): Promise<void> {
  if (!config.poolUrl || !config.poolApiKey || !config.railwayApiToken || !config.railwayTeamId) {
    console.log("[webhook] Skipping webhook registration: missing POOL_URL, POOL_API_KEY, RAILWAY_API_TOKEN, or RAILWAY_TEAM_ID");
    return;
  }

  const webhookUrl = `${config.poolUrl}/webhooks/railway/${config.poolApiKey}`;

  try {
    for (const eventType of WEBHOOK_EVENT_TYPES) {
      await gql(
        `mutation($input: NotificationRuleCreateInput!) {
          notificationRuleCreate(input: $input) { id }
        }`,
        {
          input: {
            workspaceId: config.railwayTeamId,
            channel: "webhook",
            destination: webhookUrl,
            eventType,
          },
        },
      );
    }
    console.log(`[webhook] Registered ${WEBHOOK_EVENT_TYPES.length} webhook rules → ${config.poolUrl}/webhooks/railway/***`);
  } catch (err: any) {
    // Don't crash the server if webhook registration fails
    console.warn(`[webhook] Failed to register webhook rules: ${err.message}`);
  }
}
