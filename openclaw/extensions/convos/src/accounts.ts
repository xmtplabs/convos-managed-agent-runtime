import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import type { ConvosConfig } from "./config-types.js";
import { loadConvosCredentials } from "./credentials.js";

export type CoreConfig = {
  channels?: {
    convos?: ConvosConfig;
  };
  [key: string]: unknown;
};

export type ResolvedConvosAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  /** CLI-managed identity ID (stored in ~/.convos/identities/) */
  identityId?: string;
  /** XMTP environment */
  env: "production" | "dev";
  debug: boolean;
  /** Owner conversation ID for operator communication */
  ownerConversationId?: string;
  config: ConvosConfig;
};

export function listConvosAccountIds(_cfg: CoreConfig): string[] {
  return [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultConvosAccountId(cfg: CoreConfig): string {
  const ids = listConvosAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveConvosAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedConvosAccount {
  const accountId = normalizeAccountId(params.accountId);
  const base = params.cfg.channels?.convos ?? {};
  const enabled = base.enabled !== false;

  // Credentials file takes priority over config (credentials persist across deploys)
  const creds = loadConvosCredentials();
  const identityId = creds?.identityId ?? base.identityId;
  const ownerConversationId = creds?.ownerConversationId ?? base.ownerConversationId;

  return {
    accountId,
    enabled,
    name: base.name?.trim() || undefined,
    configured: Boolean(ownerConversationId),
    identityId,
    env: base.env ?? "production",
    debug: base.debug ?? false,
    ownerConversationId,
    config: base,
  };
}

export function listEnabledConvosAccounts(cfg: CoreConfig): ResolvedConvosAccount[] {
  return listConvosAccountIds(cfg)
    .map((accountId) => resolveConvosAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
