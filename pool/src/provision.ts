import * as db from "./db/pool";
import { config } from "./config";

interface ProvisionOpts {
  agentName: string;
  instructions: string;
  joinUrl?: string;
}

export async function provision(opts: ProvisionOpts) {
  const { agentName, instructions, joinUrl } = opts;

  const instance = await db.claimIdle();
  if (!instance) return null;

  try {
    console.log(`[provision] Claiming ${instance.id} for "${agentName}"${joinUrl ? " (join)" : ""}`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.poolApiKey}`,
    };

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
    const result = await provisionRes.json() as { conversationId: string; inviteUrl?: string; joined?: boolean };

    await db.completeClaim(instance.id, {
      agentName,
      conversationId: result.conversationId,
      inviteUrl: result.inviteUrl || joinUrl || null,
      instructions,
    });

    console.log(`[provision] Provisioned ${instance.id}: ${result.joined ? "joined" : "created"} conversation ${result.conversationId}`);

    return {
      inviteUrl: result.inviteUrl || null,
      conversationId: result.conversationId,
      instanceId: instance.id,
      joined: result.joined,
      gatewayUrl: instance.url || null,
    };
  } catch (err) {
    await db.releaseClaim(instance.id);
    throw err;
  }
}
