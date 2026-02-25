const STUCK_TIMEOUT_MS = parseInt(process.env.POOL_STUCK_TIMEOUT_MS || String(15 * 60 * 1000), 10);

const STARTING_STATUSES = new Set(["QUEUED", "WAITING", "BUILDING", "DEPLOYING"]);
const DEAD_STATUSES = new Set(["FAILED", "CRASHED", "REMOVED", "SKIPPED"]);

// Derive pool status from Railway deploy status + health check + metadata.
// healthCheck is the parsed JSON from /pool/health ({ ready: boolean }), or null if unreachable.
// isClaimed indicates whether the pool manager has provisioned this instance (claimed).
export function deriveStatus({ deployStatus, healthCheck = null, createdAt = null, isClaimed = false }) {
  if (deployStatus === "SLEEPING") return "sleeping";
  if (DEAD_STATUSES.has(deployStatus)) return isClaimed ? "crashed" : "dead";

  // Claimed instances that are rebuilding (e.g. after provision redeploy) stay "claimed"
  if (STARTING_STATUSES.has(deployStatus)) return isClaimed ? "claimed" : "starting";

  if (deployStatus === "SUCCESS") {
    if (healthCheck?.ready) {
      return isClaimed ? "claimed" : "idle";
    }
    // Unreachable — check age
    const age = createdAt ? Date.now() - new Date(createdAt).getTime() : Infinity;
    if (isClaimed) return "claimed"; // claimed but restarting — don't lose status
    return age < STUCK_TIMEOUT_MS ? "starting" : "dead";
  }

  // Unknown or null deploy status — treat as starting if young
  const age = createdAt ? Date.now() - new Date(createdAt).getTime() : Infinity;
  return isClaimed ? "claimed" : (age < STUCK_TIMEOUT_MS ? "starting" : "dead");
}
