/**
 * Provisioning: claim an idle instance and set up convos identity + conversation.
 *
 * Flow:
 *   1. POST /pool/provision — write AGENTS.md + invite/join convos
 *
 * The pool-server handles the full convos flow (invite or join) internally,
 * using the channel client's auto-created identity (persisted in state-dir).
 *
 * To disable convos provisioning, comment out the import in pool.js.
 */

import * as db from "./db/pool.js";
import * as cache from "./cache.js";

const POOL_API_KEY = process.env.POOL_API_KEY;

export async function provision(opts) {
  const { agentName, instructions, joinUrl } = opts;

  const instance = cache.findClaimable();
  if (!instance) return null;

  cache.startClaim(instance.serviceId);
  try {
    console.log(`[provision] Claiming ${instance.id} for "${agentName}"${joinUrl ? " (join)" : ""}`);

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${POOL_API_KEY}`,
    };

    // Write instructions + invite/join convos via pool API
    const provisionRes = await fetch(`${instance.url}/pool/provision`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ agentName, instructions: instructions || "", joinUrl }),
    });
    if (!provisionRes.ok) {
      const text = await provisionRes.text();
      throw new Error(`Provision failed on ${instance.id}: ${provisionRes.status} ${text}`);
    }
    const result = await provisionRes.json();

    // Insert metadata row (persist resource IDs from cache so destroy can read them from DB)
    const sourceBranch = process.env.RAILWAY_SOURCE_BRANCH || process.env.RAILWAY_GIT_BRANCH || null;
    await db.insertMetadata({
      id: instance.id,
      railwayServiceId: instance.serviceId,
      agentName,
      conversationId: result.conversationId,
      inviteUrl: result.inviteUrl || joinUrl || null,
      instructions,
      sourceBranch,
      openrouterKeyHash: instance.openRouterKeyHash || null,
      agentmailInboxId: instance.agentMailInboxId || null,
    });

    // Update cache
    cache.set(instance.serviceId, {
      ...instance,
      status: "claimed",
      agentName,
      conversationId: result.conversationId,
      inviteUrl: result.inviteUrl || joinUrl || null,
      instructions,
      claimedAt: new Date().toISOString(),
    });

    console.log(`[provision] Provisioned ${instance.id}: ${result.joined ? "joined" : "created"} conversation ${result.conversationId}`);

    return {
      inviteUrl: result.inviteUrl || null,
      conversationId: result.conversationId,
      instanceId: instance.id,
      joined: result.joined,
      gatewayToken: instance.gatewayToken || null,
      gatewayUrl: instance.url || null,
    };
  } finally {
    cache.endClaim(instance.serviceId);
  }
}
