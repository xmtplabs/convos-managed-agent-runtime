/**
 * Setup: Create XMTP identity and owner conversation, return invite URL.
 * Does not write config; caller persists after join is confirmed.
 */

import type { InviteContext } from "convos-node-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { ConvosSetupResult } from "./types.js";
import { resolveConvosAccount, type CoreConfig } from "./accounts.js";
import { resolveConvosDbPath } from "./lib/convos-client.js";
import { createUser } from "./lib/identity.js";
import { getConvosRuntime } from "./runtime.js";
import { ConvosSDKClient } from "./sdk-client.js";

export type SetupConvosParams = {
  accountId?: string;
  env?: "production" | "dev";
  name?: string;
  /** If true, generates a new XMTP identity even if one already exists in config */
  forceNewKey?: boolean;
  /** If true, keeps agent running to accept join requests (caller must stop it) */
  keepRunning?: boolean;
  /** Handler for incoming invite/join requests */
  onInvite?: (ctx: InviteContext) => Promise<void>;
};

export type SetupConvosResultWithClient = ConvosSetupResult & {
  /** The running client (only if keepRunning=true) */
  client?: ConvosSDKClient;
};

/**
 * Setup Convos by creating an XMTP identity and owner conversation.
 * Returns an invite URL that can be displayed as a QR code.
 *
 * Does NOT write config — the caller should persist config after the user
 * has successfully joined the conversation.
 *
 * If keepRunning=true, the agent stays running to accept join requests.
 * Caller is responsible for stopping it later.
 */
export async function setupConvosWithInvite(
  params: SetupConvosParams,
): Promise<SetupConvosResultWithClient> {
  const runtime = getConvosRuntime();
  const cfg = runtime.config.loadConfig() as OpenClawConfig;
  const account = resolveConvosAccount({
    cfg: cfg as CoreConfig,
    accountId: params.accountId,
  });

  // Pre-generate the private key so we can resolve the persistent DB path
  // before creating the client. This ensures setup and channel restart use
  // the same DB, so conversation membership survives the restart.
  const env = params.env ?? account.env;
  const existingKey = params.forceNewKey ? undefined : account.privateKey;
  const generatedKey = existingKey ?? createUser().key;
  const stateDir = runtime.state.resolveStateDir();
  const dbPath = resolveConvosDbPath({
    stateDir,
    env,
    accountId: account.accountId,
    privateKey: generatedKey,
  });

  const client = await ConvosSDKClient.create({
    privateKey: generatedKey,
    env,
    dbPath,
    debug: false,
    onInvite: params.onInvite,
  });

  try {
    // Start the agent to enable conversation creation
    await client.start();

    // Create a new conversation (this will be the owner conversation)
    const conversationName = params.name ?? "OpenClaw";
    const result = await client.createConversation(conversationName);

    const privateKey = client.getPrivateKey();
    const inboxId = client.getInboxId();

    // Keep running or stop based on option
    if (!params.keepRunning) {
      await client.stop();
    }

    return {
      inviteUrl: result.inviteUrl,
      conversationId: result.conversationId,
      privateKey,
      inboxId,
      client: params.keepRunning ? client : undefined,
    };
  } catch (err) {
    await client.stop();
    throw err;
  }
}
