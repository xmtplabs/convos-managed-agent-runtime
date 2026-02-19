/**
 * Instance key provisioning. Pool manager reads INSTANCE_* env vars and passes
 * them to Railway services (warm-up and claim). Set these in the pool manager's .env.
 */

import { randomBytes } from "crypto";

const POOL_API_KEY = process.env.POOL_API_KEY;
const INSTANCE_VAR_MAP = {
  OPENCLAW_PRIMARY_MODEL: "INSTANCE_OPENCLAW_PRIMARY_MODEL",
  OPENCLAW_GATEWAY_TOKEN: "INSTANCE_OPENCLAW_GATEWAY_TOKEN",
  SETUP_PASSWORD: "INSTANCE_SETUP_PASSWORD",
  XMTP_ENV: "INSTANCE_XMTP_ENV",
  AGENTMAIL_API_KEY: "INSTANCE_AGENTMAIL_API_KEY",
  BANKR_API_KEY: "INSTANCE_BANKR_API_KEY",
  TELNYX_API_KEY: "INSTANCE_TELNYX_API_KEY",
  TELNYX_PHONE_NUMBER: "INSTANCE_TELNYX_PHONE_NUMBER",
  TELNYX_MESSAGING_PROFILE_ID: "INSTANCE_TELNYX_MESSAGING_PROFILE_ID",
};

function getEnv(name, fallback = "") {
  const val = process.env[name];
  return val != null && val !== "" ? val : fallback;
}

/** Build env vars for instance (warm-up and claim). Omit OPENCLAW_GATEWAY_TOKEN and SETUP_PASSWORD when INSTANCE_* are unset so provision does not overwrite warmup-generated values. */
export function instanceEnvVars() {
  const gatewayToken = getEnv(INSTANCE_VAR_MAP.OPENCLAW_GATEWAY_TOKEN);
  const setupPassword = getEnv(INSTANCE_VAR_MAP.SETUP_PASSWORD);
  const vars = {
    OPENCLAW_STATE_DIR: "/app",
    NODE_ENV:'development',
    OPENCLAW_PRIMARY_MODEL: getEnv(INSTANCE_VAR_MAP.OPENCLAW_PRIMARY_MODEL),
    OPENROUTER_API_KEY: getEnv(INSTANCE_VAR_MAP.OPENROUTER_API_KEY),
    XMTP_ENV: getEnv(INSTANCE_VAR_MAP.XMTP_ENV, "dev"),
    CHROMIUM_PATH: "/usr/bin/chromium",
    POOL_API_KEY: POOL_API_KEY || "",
    AGENTMAIL_API_KEY: getEnv(INSTANCE_VAR_MAP.AGENTMAIL_API_KEY),
    BANKR_API_KEY: getEnv(INSTANCE_VAR_MAP.BANKR_API_KEY),
    TELNYX_API_KEY: getEnv(INSTANCE_VAR_MAP.TELNYX_API_KEY),
    TELNYX_PHONE_NUMBER: getEnv(INSTANCE_VAR_MAP.TELNYX_PHONE_NUMBER),
    TELNYX_MESSAGING_PROFILE_ID: getEnv(INSTANCE_VAR_MAP.TELNYX_MESSAGING_PROFILE_ID),
  };
  if (gatewayToken) vars.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  if (setupPassword) vars.SETUP_PASSWORD = setupPassword;
  return vars;
}

/** Generate a random gateway token (64 hex chars, like openssl rand -hex 32). */
export function generateGatewayToken() {
  return randomBytes(32).toString("hex");
}

/** Generate a random setup password (32 hex chars, like openssl rand -hex 16). */
export function generateSetupPassword() {
  return randomBytes(16).toString("hex");
}

/** Generate a random Ethereum wallet private key (0x + 64 hex chars). */
export function generatePrivateWalletKey() {
  return "0x" + randomBytes(32).toString("hex");
}

/** Create a per-instance AgentMail inbox via the API.
 *  Returns { inboxId, perInstance } — perInstance is always true when an inbox is created. */
export async function resolveAgentMailInbox(instanceId) {
  const apiKey = getEnv(INSTANCE_VAR_MAP.AGENTMAIL_API_KEY);
  if (!apiKey) return { inboxId: "", perInstance: false };
  return createAgentMailInbox(apiKey, instanceId);
}

/** Create a per-instance AgentMail inbox. */
async function createAgentMailInbox(apiKey, instanceId) {
  const username = `convos-agent-${instanceId}`;
  const clientId = `convos-agent-${instanceId}`;

  const res = await fetch("https://api.agentmail.to/v0/inboxes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, display_name: "Convos Agent", client_id: clientId }),
  });
  const body = await res.json();
  const inboxId = body?.inbox_id;
  if (!inboxId) {
    console.error("[keys] AgentMail create inbox failed:", res.status, body);
    throw new Error(`AgentMail inbox creation failed: ${res.status}`);
  }
  console.log(`[keys] Created AgentMail inbox ${inboxId} for ${clientId}`);
  return { inboxId, perInstance: true };
}

/** Delete an AgentMail inbox. Best-effort — logs and swallows errors. */
export async function deleteAgentMailInbox(inboxId) {
  const apiKey = getEnv(INSTANCE_VAR_MAP.AGENTMAIL_API_KEY);
  if (!apiKey || !inboxId) return;

  try {
    const res = await fetch(`https://api.agentmail.to/v0/inboxes/${inboxId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      console.log(`[keys] Deleted AgentMail inbox ${inboxId}`);
    } else {
      const body = await res.text();
      console.warn(`[keys] Failed to delete AgentMail inbox ${inboxId}: ${res.status} ${body}`);
    }
  } catch (err) {
    console.warn(`[keys] Failed to delete AgentMail inbox ${inboxId}:`, err.message);
  }
}

/** Resolve OPENROUTER_API_KEY. Priority: 1) 2) create via OPENROUTER_MANAGEMENT_KEY.
 *  Returns { key, hash } — hash is null for shared keys or when no key is available. */
export async function resolveOpenRouterApiKey(instanceId) {
  const existing = getEnv(INSTANCE_VAR_MAP.OPENROUTER_API_KEY);
  if (existing) return { key: existing, hash: null }; // never create when shared key is configured
  if (!process.env.OPENROUTER_MANAGEMENT_KEY) return { key: "", hash: null };
  return createOpenRouterKey(instanceId);
}

/** Create an OpenRouter API key via management API. Pool manager only; never pass management key to instances. */
export async function createOpenRouterKey(instanceId) {
  const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!mgmtKey) throw new Error("OPENROUTER_MANAGEMENT_KEY not set");

  const name = `convos-agent-${instanceId}`;
  const limit = parseInt(process.env.OPENROUTER_KEY_LIMIT || "20", 10);
  const limitReset = process.env.OPENROUTER_KEY_LIMIT_RESET || "monthly";

  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mgmtKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, limit, limit_reset: limitReset }),
  });
  const body = await res.json();
  const key = body?.key;
  const hash = body?.data?.hash ?? null;
  if (!key) {
    console.error("[keys] OpenRouter create key failed:", res.status, body);
    throw new Error(`OpenRouter key creation failed: ${res.status}`);
  }
  console.log(`[keys] Created OpenRouter key for ${name} (hash=${hash})`);
  return { key, hash };
}

/** Lookup an OpenRouter key hash by instance name. Returns hash or null. */
async function findOpenRouterKeyHash(mgmtKey, instanceId) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/keys", {
      headers: { Authorization: `Bearer ${mgmtKey}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const keys = body?.data ?? [];
    const name = `convos-agent-${instanceId}`;
    const match = keys.find((k) => k.name === name);
    return match?.hash ?? null;
  } catch {
    return null;
  }
}

/** Delete an OpenRouter API key by hash (preferred) or by instance ID lookup (fallback).
 *  Best-effort — logs and swallows errors. */
export async function deleteOpenRouterKey(hash, instanceId) {
  const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!mgmtKey) return;

  let targetHash = hash;
  if (!targetHash && instanceId) {
    targetHash = await findOpenRouterKeyHash(mgmtKey, instanceId);
    if (!targetHash) {
      console.log(`[keys] No OpenRouter key found for instance ${instanceId}`);
      return;
    }
    console.log(`[keys] Resolved OpenRouter key hash for ${instanceId}: ${targetHash}`);
  }
  if (!targetHash) return;

  try {
    const res = await fetch(`https://openrouter.ai/api/v1/keys/${targetHash}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${mgmtKey}` },
    });
    if (res.ok) {
      console.log(`[keys] Deleted OpenRouter key (hash=${targetHash})`);
    } else {
      const body = await res.text();
      console.warn(`[keys] Failed to delete OpenRouter key (hash=${targetHash}): ${res.status} ${body}`);
    }
  } catch (err) {
    console.warn(`[keys] Failed to delete OpenRouter key (hash=${targetHash}):`, err.message);
  }
}
