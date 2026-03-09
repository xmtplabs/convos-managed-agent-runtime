import * as db from "./db/pool";
import { authFetch } from "./authFetch";
import { metricCount, metricHistogram } from "./metrics";
import { logger, classifyError } from "./logger";

export type ProvisionProgressCallback = (step: string, status: string, message?: string) => void;

interface ProvisionOpts {
  agentName: string;
  instructions: string;
  joinUrl?: string;
  source?: string;
  onProgress?: ProvisionProgressCallback;
}

export async function provision(opts: ProvisionOpts) {
  const { agentName, instructions, joinUrl, source, onProgress } = opts;
  const claimStart = Date.now();
  const report = (step: string, status: string, message?: string) => {
    if (onProgress) onProgress(step, status, message);
  };

  metricCount("instance.claim.start");
  report("claim", "active", "Finding available instance…");
  let instance;
  try {
    instance = await db.claimIdle();
  } catch (err) {
    const { error_class, error_message } = classifyError(err);
    metricCount("instance.claim.fail", 1, { reason: "db_error", error_class, stage: "claim" });
    logger.error("claim.fail", { stage: "claim", error_class, error_message: error_message.slice(0, 1500), agentName, hasJoinUrl: !!joinUrl, source });
    report("claim", "fail", "Database error while claiming");
    throw err;
  }
  if (!instance) {
    metricCount("instance.claim.fail", 1, { reason: "no_idle" });
    logger.warn("claim.no_idle", { agentName, hasJoinUrl: !!joinUrl, source });
    report("claim", "fail", "No idle instances available");
    return null;
  }

  report("claim", "ok", `Claimed ${instance.name || instance.id}`);

  try {
    console.log(`[provision] Claiming ${instance.id} for "${agentName}"${joinUrl ? " (join)" : ""}`);
    logger.info("claim.start", { instanceId: instance.id, agentName, hasJoinUrl: !!joinUrl, source });

    report("provision", "active", joinUrl ? "Joining conversation…" : "Configuring agent…");

    const gatewayToken = await db.getGatewayToken(instance.id);

    const provisionRes = await authFetch(`${instance.url}/pool/provision`, {
      gatewayToken,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ agentName, instructions: instructions || "", joinUrl }),
    });
    if (!provisionRes.ok) {
      const text = await provisionRes.text();
      throw Object.assign(
        new Error(`Provision failed on ${instance.id}: ${provisionRes.status} ${text.slice(0, 1500)}`),
        { status: provisionRes.status },
      );
    }
    const result = await provisionRes.json() as { conversationId: string; inviteUrl?: string; joined?: boolean };

    report("provision", "ok", "Agent provisioned on instance");

    report("convo", "active", "Saving to database…");
    await db.completeClaim(instance.id, {
      agentName,
      conversationId: result.conversationId,
      inviteUrl: result.inviteUrl || joinUrl || null,
      instructions,
    });

    const convoMsg = result.joined
      ? `Joined conversation ${result.conversationId.slice(0, 8)}…`
      : `Created conversation ${result.conversationId.slice(0, 8)}…`;
    report("convo", "ok", convoMsg);

    const durationMs = Date.now() - claimStart;
    console.log(`[provision] Provisioned ${instance.id}: ${result.joined ? "joined" : "created"} conversation ${result.conversationId}`);
    logger.info("claim.complete", {
      instanceId: instance.id,
      agentName,
      conversationId: result.conversationId,
      joined: !!result.joined,
      duration_ms: durationMs,
      source,
    });

    metricCount("instance.claim.complete");
    metricHistogram("instance.claim.duration_ms", durationMs);

    return {
      inviteUrl: result.inviteUrl || null,
      conversationId: result.conversationId,
      instanceId: instance.id,
      joined: result.joined,
      gatewayUrl: instance.url || null,
      agentName,
    };
  } catch (err) {
    const { error_class, error_message } = classifyError(err);
    const durationMs = Date.now() - claimStart;

    metricCount("instance.claim.fail", 1, { reason: "provision_error", error_class, stage: "provision" });
    metricHistogram("instance.claim.duration_ms", durationMs);

    logger.error("claim.fail", {
      instanceId: instance.id,
      agentName,
      hasJoinUrl: !!joinUrl,
      stage: "provision",
      error_class,
      error_message: error_message.slice(0, 1500),
      duration_ms: durationMs,
      source,
    });

    console.error(`[provision] Instance ${instance.id} failed, marking crashed: ${error_message.slice(0, 200)}`);
    report("provision", "fail", error_message.slice(0, 200));
    report("convo", "skip");
    // Any provision failure taints the instance — even transient errors
    // (timeouts, network blips) may have partially executed on the runtime
    // (wrote instructions, started a join). Releasing back to idle risks an
    // infinite retry loop. Mark crashed; manual cleanup via dashboard.
    await db.updateStatus(instance.id, { status: "crashed" });
    throw err;
  }
}
