/**
 * Config/account resolution: list and resolve Convos accounts from OpenClaw config.
 */
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import { XMTP_ENV_DEFAULT, type ConvosConfig } from "./config-types.js";

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
  /** Hex-encoded XMTP private key (undefined until first run) */
  privateKey?: string;
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

  // Identity is created on first start (config or state-dir); no key required in config
  const configured = enabled;

  return {
    accountId,
    enabled,
    name: base.name?.trim() || undefined,
    configured,
    privateKey: base.privateKey,
    env: base.XMTP_ENV ?? XMTP_ENV_DEFAULT,
    debug: base.debug ?? false,
    ownerConversationId: base.ownerConversationId,
    config: base,
  };
}

export function listEnabledConvosAccounts(cfg: CoreConfig): ResolvedConvosAccount[] {
  return listConvosAccountIds(cfg)
    .map((accountId) => resolveConvosAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
