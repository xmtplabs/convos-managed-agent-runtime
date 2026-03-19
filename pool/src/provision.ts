import * as db from "./db/pool";
import { authFetch } from "./authFetch";
import { metricCount, metricHistogram } from "./metrics";
import { logger, classifyError } from "./logger";
import { parseRuntimeStatus } from "./runtimeStatus";

export type ProvisionProgressCallback = (step: string, status: string, message?: string) => void;

interface ProvisionOpts {
  agentName: string;
  instructions: string;
  joinUrl?: string;
  profileImage?: string;
  metadata?: Record<string, string>;
  source?: string;
  onProgress?: ProvisionProgressCallback;
}

async function resetAndVerifyRuntime(instanceUrl: string | null, gatewayToken: string | null) {
  if (!instanceUrl) throw new Error("Instance URL missing during rollback");
  const resetRes = await authFetch(`${instanceUrl}/convos/reset`, {
    gatewayToken, method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({}),
  });
  if (!resetRes.ok) {
    const text = await resetRes.text();
    throw new Error(`/convos/reset returned ${resetRes.status}: ${text.slice(0, 1500)}`);
  }
  const statusRes = await authFetch(`${instanceUrl}/convos/status`, {
    gatewayToken, signal: AbortSignal.timeout(5_000),
  });
  if (!statusRes.ok) {
    const text = await statusRes.text();
    throw new Error(`/convos/status returned ${statusRes.status}: ${text.slice(0, 1500)}`);
  }
  return parseRuntimeStatus(await statusRes.json());
}

export async function provision(opts: ProvisionOpts) {
  const { agentName, instructions, joinUrl, profileImage, metadata, source, onProgress } = opts;
  const claimStart = Date.now();
  const report = (step: string, status: string, message?: string) => {
    if (onProgress) onProgress(step, status, message);
  };

  metricCount("instance.claim.start");

  // Fast-path dedup: skip the claim transaction if an instance is already handling this joinUrl.
  // The real atomic guard is inside claimIdle(), but this avoids the heavier transaction.
  if (joinUrl && await db.hasActiveInviteUrl(joinUrl)) {
    logger.info("claim.dedup", { joinUrl, agentName, source });
    report("claim", "ok", "Already provisioning for this conversation");
    return null;
  }

  report("claim", "active", "Finding available instance…");
  let instance;
  try {
    instance = await db.claimIdle(joinUrl);
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
      signal: AbortSignal.timeout(75_000),
      body: JSON.stringify({ agentName, instructions: instructions || "", joinUrl, profileImage, metadata }),
    });
    if (!provisionRes.ok) {
      const text = await provisionRes.text();
      throw Object.assign(
        new Error(`Provision failed on ${instance.id}: ${provisionRes.status} ${text.slice(0, 1500)}`),
        { status: provisionRes.status },
      );
    }
    const result = await provisionRes.json() as {
      conversationId: string | null;
      inviteUrl?: string | null;
      joined?: boolean;
      status?: string | null;
    };

    // ── Pending acceptance: join is waiting for approval ──────────────────
    if (result.status === "pending_acceptance") {
      report("provision", "ok", "Join is waiting for acceptance");
      report("convo", "active", "Saving pending state to database…");
      const updated = await db.markClaimPendingAcceptance(instance.id, {
        agentName, inviteUrl: result.inviteUrl || joinUrl || null, instructions,
      });
      if (!updated) throw new Error("Claim status changed before pending acceptance could be recorded");
      report("convo", "ok", "Instance reserved while join waits for approval");
      return {
        inviteUrl: result.inviteUrl || joinUrl || null,
        conversationId: null,
        instanceId: instance.id,
        joined: false,
        status: "pending_acceptance" as const,
        gatewayUrl: instance.url || null,
        agentName,
      };
    }

    // ── Immediate success ────────────────────────────────────────────────
    report("provision", "ok", "Agent provisioned on instance");

    report("convo", "active", "Saving to database…");
    const conversationId = result.conversationId;
    if (!conversationId) throw new Error("Provision succeeded without a conversationId");
    await db.completeClaim(instance.id, {
      agentName, conversationId,
      inviteUrl: result.inviteUrl || joinUrl || null, instructions,
    });

    const convoMsg = result.joined
      ? `Joined conversation ${conversationId.slice(0, 8)}…`
      : `Created conversation ${conversationId.slice(0, 8)}…`;
    report("convo", "ok", convoMsg);

    const durationMs = Date.now() - claimStart;
    console.log(`[provision] Provisioned ${instance.id}: ${result.joined ? "joined" : "created"} conversation ${conversationId}`);
    logger.info("claim.complete", {
      instanceId: instance.id, agentName, conversationId,
      joined: !!result.joined, duration_ms: durationMs, source,
    });

    metricCount("instance.claim.complete");
    metricHistogram("instance.claim.duration_ms", durationMs);

    return {
      inviteUrl: result.inviteUrl || null,
      conversationId,
      instanceId: instance.id,
      joined: result.joined,
      status: result.status || "claimed",
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

    console.error(`[provision] Instance ${instance.id} failed: ${error_message.slice(0, 200)}`);
    report("provision", "fail", error_message.slice(0, 200));
    report("convo", "skip");

    const httpStatus = (err instanceof Error && "status" in err) ? (err as Error & { status: number }).status : undefined;

    if (httpStatus === 409) {
      // 409 = runtime is already bound to a conversation. Another request owns
      // this instance's lifecycle — don't touch its status.
      logger.warn("claim.already_bound", { instanceId: instance.id, agentName, source });
    } else {
      // Try to reset the runtime and check if it's clean. If clean, recover to idle.
      report("cleanup", "active", "Resetting runtime…");
      try {
        const runtimeStatus = await resetAndVerifyRuntime(instance.url, await db.getGatewayToken(instance.id));
        if (runtimeStatus.clean === true) {
          const updated = await db.recoverClaimToIdle(instance.id);
          if (updated) {
            logger.info("claim.rollback_complete", { instanceId: instance.id, agentName, source });
            report("cleanup", "ok", "Runtime reset and returned to idle");
          } else {
            logger.warn("claim.rollback_skipped", { instanceId: instance.id, agentName, source });
            report("cleanup", "skip", "Claim status changed before rollback completed");
          }
        } else {
          await db.failClaim(instance.id);
          logger.error("claim.rollback_failed", {
            instanceId: instance.id, agentName, source,
            runtimeConversationId: runtimeStatus.conversationId,
            clean: runtimeStatus.clean,
            pending: runtimeStatus.pending,
          });
          report("cleanup", "fail", "Runtime remained dirty after reset");
        }
      } catch (resetErr) {
        const { error_message: reset_error_message } = classifyError(resetErr);
        await db.failClaim(instance.id);
        logger.error("claim.rollback_failed", {
          instanceId: instance.id, agentName, source,
          error_message: reset_error_message.slice(0, 1500),
        });
        report("cleanup", "fail", "Runtime reset failed");
      }
    }
    throw err;
  }
}
