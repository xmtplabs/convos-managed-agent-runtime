/**
 * Pure webhook state machine — no external dependencies.
 * Testable in isolation without DB, metrics, or HTTP.
 */

export type WebhookAction = "health_check" | "set_status" | "noop";

export interface WebhookDecision {
  action: WebhookAction;
  newStatus?: string;
}

/**
 * Given a Railway event type and current instance state,
 * returns what action the webhook handler should take.
 */
export function decideAction(
  eventType: string,
  currentStatus: string,
  isClaimed: boolean,
): WebhookDecision {
  // Never touch instances mid-claim
  if (currentStatus === "claiming") return { action: "noop" };

  switch (eventType) {
    case "Deployment.deployed": {
      if (currentStatus === "starting" || currentStatus === "sleeping") {
        return { action: "health_check" };
      }
      // Claimed + crashed → health check to recover
      if (isClaimed && currentStatus === "crashed") {
        return { action: "health_check" };
      }
      return { action: "noop" };
    }

    case "Deployment.crashed":
    case "Deployment.failed":
    case "Deployment.oom_killed": {
      // Already in a terminal state — no-op (idempotent)
      if (currentStatus === "dead" || currentStatus === "crashed") {
        return { action: "noop" };
      }
      return { action: "set_status", newStatus: isClaimed ? "crashed" : "dead" };
    }

    case "Deployment.slept": {
      return { action: "set_status", newStatus: "sleeping" };
    }

    case "Deployment.resumed": {
      if (currentStatus === "sleeping") {
        return { action: "health_check" };
      }
      return { action: "noop" };
    }

    default:
      return { action: "noop" };
  }
}
