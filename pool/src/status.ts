const STUCK_TIMEOUT_MS = parseInt(process.env.POOL_STUCK_TIMEOUT_MS || String(15 * 60 * 1000), 10);

const STARTING_STATUSES = new Set(["QUEUED", "WAITING", "BUILDING", "DEPLOYING"]);
const DEAD_STATUSES = new Set(["FAILED", "CRASHED", "REMOVED", "SKIPPED"]);

interface DeriveStatusOpts {
  deployStatus: string | null;
  healthCheck?: { ready: boolean } | null;
  createdAt?: string | null;
  isClaimed?: boolean;
}

export function deriveStatus({ deployStatus, healthCheck = null, createdAt = null, isClaimed = false }: DeriveStatusOpts): string {
  if (deployStatus === "SLEEPING") return "sleeping";
  if (deployStatus && DEAD_STATUSES.has(deployStatus)) return isClaimed ? "crashed" : "dead";

  if (deployStatus && STARTING_STATUSES.has(deployStatus)) return isClaimed ? "claimed" : "starting";

  if (deployStatus === "SUCCESS") {
    if (healthCheck?.ready) {
      return isClaimed ? "claimed" : "idle";
    }
    const age = createdAt ? Date.now() - new Date(createdAt).getTime() : Infinity;
    if (isClaimed) return "claimed";
    return age < STUCK_TIMEOUT_MS ? "starting" : "dead";
  }

  const age = createdAt ? Date.now() - new Date(createdAt).getTime() : Infinity;
  return isClaimed ? "claimed" : (age < STUCK_TIMEOUT_MS ? "starting" : "dead");
}
