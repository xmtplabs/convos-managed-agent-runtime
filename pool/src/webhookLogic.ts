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
      if (
        currentStatus === "starting"
        || currentStatus === "sleeping"
        || currentStatus === "pending_acceptance"
        || currentStatus === "tainted"
      ) {
        return { action: "health_check" };
      }
      if (currentStatus === "crashed" || currentStatus === "dead") {
        return { action: "health_check" };
      }
      return { action: "noop" };
    }

    case "Deployment.crashed":
    case "Deployment.failed":
    case "Deployment.oom_killed": {
      if (currentStatus === "dead" || currentStatus === "crashed") {
        return { action: "noop" };
      }
      // pending_acceptance has reserved state (agent name, invite) — treat like claimed
      const hasReservedState = isClaimed || currentStatus === "pending_acceptance";
      return { action: "set_status", newStatus: hasReservedState ? "crashed" : "dead" };
    }

    case "Deployment.slept": {
      if (currentStatus === "pending_acceptance") return { action: "noop" };
      return { action: "set_status", newStatus: "sleeping" };
    }

    case "Deployment.resumed": {
      if (
        currentStatus === "sleeping"
        || currentStatus === "crashed"
        || currentStatus === "dead"
        || currentStatus === "pending_acceptance"
        || currentStatus === "tainted"
      ) {
        return { action: "health_check" };
      }
      return { action: "noop" };
    }

    default:
      return { action: "noop" };
  }
}
