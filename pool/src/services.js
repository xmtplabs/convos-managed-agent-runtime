/**
 * Service registry for per-instance resource provisioning and cleanup.
 *
 * Each service defines how to create/destroy external resources tied to agent
 * instances (API keys, inboxes, etc.). To add a new service, call register()
 * with a definition object and resources will be automatically created during
 * instance warm-up and cleaned up on teardown.
 *
 * Service definition shape:
 *   name                                — unique identifier
 *   envVars()                           — static env vars for every instance (optional)
 *   create(instanceId)                  — provision per-instance resource → { envVars, cache } | null (optional)
 *   destroy({ resourceId, instanceId }) — clean up resource, best-effort (optional)
 *   resolveResourceId(inst, dbRow)      — extract resource ID for destroy (optional)
 *   shouldSkipDestroy(resourceId)       — return true to skip destroy (optional)
 *
 * For orphan cleanup (clean-providers CLI):
 *   cleanup.target                      — CLI target name (e.g. "email", "openrouter")
 *   cleanup.envVars()                   — [[name, value]] pairs to display in confirmation
 *   cleanup.getActiveIds(pool)          — DB query → Set of active resource IDs
 *   cleanup.findOrphaned(activeIds, activeInstanceIds) — discover orphans → []
 *   cleanup.deleteOrphaned(items)       — delete orphaned resources
 *   cleanup.formatItem(item)            — format item for display
 */

import { randomBytes } from "crypto";
import * as db from "./db/pool.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEnv(name, fallback = "") {
  const val = process.env[name];
  return val != null && val !== "" ? val : fallback;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const registry = [];

export function register(def) {
  registry.push(def);
}

export function getAll() {
  return [...registry];
}

export function get(name) {
  return registry.find((s) => s.name === name);
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/** Collect env vars from all registered services. */
export function collectServiceEnvVars() {
  const vars = {};
  for (const svc of registry) {
    if (svc.envVars) Object.assign(vars, svc.envVars());
  }
  return vars;
}

/** Create all per-instance resources. Returns { envVars, cache } to merge into instance. */
export async function createAll(instanceId) {
  const envVars = {};
  const cache = {};
  for (const svc of registry) {
    if (!svc.create) continue;
    const result = await svc.create(instanceId);
    if (!result) continue;
    if (result.envVars) Object.assign(envVars, result.envVars);
    if (result.cache) Object.assign(cache, result.cache);
  }
  return { envVars, cache };
}

/** Destroy all per-instance resources. Best-effort — logs errors, never throws.
 *  Fetches the DB row internally so callers don't need to worry about it. */
export async function destroyAll(inst) {
  const dbRow = await db.findByServiceId(inst.serviceId).catch(() => null);
  for (const svc of registry) {
    if (!svc.destroy) continue;
    const resourceId = svc.resolveResourceId?.(inst, dbRow) ?? null;
    if (svc.shouldSkipDestroy?.(resourceId)) continue;
    try {
      await svc.destroy({ resourceId, instanceId: inst.id });
    } catch (err) {
      console.warn(`[services] ${svc.name} destroy failed for ${inst.id}:`, err.message);
    }
  }
}

// ── Utility generators (not tied to a specific service) ───────────────────────

/** Generate a random gateway token (64 hex chars). */
export function generateGatewayToken() {
  return randomBytes(32).toString("hex");
}

/** Generate a random setup password (32 hex chars). */
export function generateSetupPassword() {
  return randomBytes(16).toString("hex");
}

// ── Service: OpenRouter ───────────────────────────────────────────────────────

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

register({
  name: "openrouter",

  create: async (instanceId) => {
    const shared = getEnv("INSTANCE_OPENROUTER_API_KEY");
    if (shared) return { envVars: { OPENROUTER_API_KEY: shared }, cache: {} };

    const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
    if (!mgmtKey) return null;

    const name = `convos-agent-${instanceId}`;
    const limit = parseInt(process.env.OPENROUTER_KEY_LIMIT || "20", 10);
    const limitReset = process.env.OPENROUTER_KEY_LIMIT_RESET || "monthly";

    const res = await fetch("https://openrouter.ai/api/v1/keys", {
      method: "POST",
      headers: { Authorization: `Bearer ${mgmtKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, limit, limit_reset: limitReset }),
    });
    const body = await res.json();
    if (!body?.key) {
      console.error("  ⚠️  OpenRouter create key failed:", res.status, body);
      throw new Error(`OpenRouter key creation failed: ${res.status}`);
    }
    const hash = body.data?.hash ?? null;
    console.log("  🔐 OpenRouter key → created for", name, "hash=" + hash);
    return {
      envVars: { OPENROUTER_API_KEY: body.key },
      cache: { openRouterApiKey: body.key, openRouterKeyHash: hash },
    };
  },

  resolveResourceId: (inst, dbRow) =>
    dbRow?.openrouter_key_hash || inst.openRouterKeyHash || null,

  destroy: async ({ resourceId: hash, instanceId }) => {
    const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
    if (!mgmtKey) return;

    let targetHash = hash;
    if (!targetHash && instanceId) {
      targetHash = await findOpenRouterKeyHash(mgmtKey, instanceId);
      if (!targetHash) {
        console.log("  🔐 OpenRouter key → none for instance", instanceId);
        return;
      }
      console.log("  🔐 OpenRouter key → resolved hash for", instanceId, "→", targetHash);
    }
    if (!targetHash) return;

    try {
      const res = await fetch(`https://openrouter.ai/api/v1/keys/${targetHash}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${mgmtKey}` },
      });
      if (res.ok) {
        console.log("  🔐 OpenRouter key → deleted hash=" + targetHash);
      } else {
        const body = await res.text();
        console.warn("  ⚠️  OpenRouter delete failed hash=" + targetHash, res.status, body);
      }
    } catch (err) {
      console.warn("  ⚠️  OpenRouter delete failed hash=" + targetHash, err.message);
    }
  },

  cleanup: {
    target: "openrouter",
    envVars: () => [["OPENROUTER_MANAGEMENT_KEY", process.env.OPENROUTER_MANAGEMENT_KEY]],

    getActiveIds: async (pool) => {
      const { rows } = await pool.query(
        "SELECT openrouter_key_hash FROM agent_metadata WHERE openrouter_key_hash IS NOT NULL"
      );
      return new Set(rows.map((r) => r.openrouter_key_hash));
    },

    findOrphaned: async (activeIds, activeInstanceIds) => {
      const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
      if (!mgmtKey) {
        console.log("[clean] OPENROUTER_MANAGEMENT_KEY not set — skipping key cleanup");
        return [];
      }

      console.log("[clean] Fetching OpenRouter keys...");
      const res = await fetch("https://openrouter.ai/api/v1/keys", {
        headers: { Authorization: `Bearer ${mgmtKey}` },
      });
      if (!res.ok) {
        console.error(`[clean] Failed to list keys: ${res.status} ${await res.text()}`);
        return [];
      }
      const body = await res.json();
      const keys = body?.data ?? [];
      const skipName = process.env.OPENROUTER_CLEAN_SKIP_NAME || "dont touch";

      const managed = keys.filter((k) => k.name?.startsWith("convos-agent-"));
      const orphaned = managed.filter((k) => {
        if (!k.hash) return false;
        if (activeIds.has(k.hash)) return false;
        if (k.name === skipName) return false;
        const instanceId = (k.name || "").replace("convos-agent-", "");
        if (instanceId && activeInstanceIds.has(instanceId)) return false;
        return true;
      });

      console.log(`[clean] OpenRouter: ${keys.length} total, ${managed.length} managed, ${orphaned.length} orphaned`);
      return orphaned;
    },

    deleteOrphaned: async (items) => {
      const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
      for (const key of items) {
        try {
          const del = await fetch(`https://openrouter.ai/api/v1/keys/${key.hash}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${mgmtKey}` },
          });
          if (del.ok) {
            console.log(`  [deleted] ${key.name} (hash=${key.hash})`);
          } else {
            console.warn(`  [failed]  ${key.name} (hash=${key.hash}) — ${del.status}`);
          }
        } catch (err) {
          console.warn(`  [failed]  ${key.name} (hash=${key.hash}) — ${err.message}`);
        }
      }
    },

    formatItem: (item) => `${item.name} (hash=${item.hash})`,
  },
});

// ── Service: AgentMail ────────────────────────────────────────────────────────

register({
  name: "agentmail",

  envVars: () => ({
    AGENTMAIL_API_KEY: getEnv("INSTANCE_AGENTMAIL_API_KEY"),
  }),

  create: async (instanceId) => {
    const provided = getEnv("INSTANCE_AGENTMAIL_INBOX_ID");
    if (provided) {
      return { envVars: { AGENTMAIL_INBOX_ID: provided }, cache: { agentMailInboxId: provided } };
    }

    const apiKey = getEnv("INSTANCE_AGENTMAIL_API_KEY");
    if (!apiKey) return null;

    const username = `convos-agent-${instanceId}`;
    const res = await fetch("https://api.agentmail.to/v0/inboxes", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        domain: getEnv("AGENTMAIL_DOMAIN") || undefined,
        display_name: "Convos Agent",
        client_id: `convos-agent-${instanceId}`,
      }),
    });
    const body = await res.json();
    const inboxId = body?.inbox_id;
    if (!inboxId) {
      console.error("  ⚠️  AgentMail create inbox failed:", res.status, body);
      throw new Error(`AgentMail inbox creation failed: ${res.status}`);
    }
    console.log("  📬 AgentMail inbox → created", inboxId, "for", username);
    return {
      envVars: { AGENTMAIL_INBOX_ID: inboxId },
      cache: { agentMailInboxId: inboxId },
    };
  },

  resolveResourceId: (inst, dbRow) =>
    dbRow?.agentmail_inbox_id || inst.agentMailInboxId || null,

  shouldSkipDestroy: (resourceId) => {
    const shared = process.env.INSTANCE_AGENTMAIL_INBOX_ID;
    return !!(shared && resourceId === shared);
  },

  destroy: async ({ resourceId: inboxId }) => {
    const apiKey = getEnv("INSTANCE_AGENTMAIL_API_KEY");
    if (!apiKey || !inboxId) return;

    try {
      const res = await fetch(`https://api.agentmail.to/v0/inboxes/${inboxId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        console.log("  📬 AgentMail inbox → deleted", inboxId);
      } else {
        const body = await res.text();
        console.warn("  ⚠️  AgentMail delete failed:", inboxId, res.status, body);
      }
    } catch (err) {
      console.warn("  ⚠️  AgentMail delete failed:", inboxId, err.message);
    }
  },

  cleanup: {
    target: "email",
    envVars: () => [["AGENTMAIL_API_KEY", process.env.AGENTMAIL_API_KEY || process.env.INSTANCE_AGENTMAIL_API_KEY]],

    getActiveIds: async (pool) => {
      const { rows } = await pool.query(
        "SELECT agentmail_inbox_id FROM agent_metadata WHERE agentmail_inbox_id IS NOT NULL"
      );
      return new Set(rows.map((r) => r.agentmail_inbox_id));
    },

    findOrphaned: async (activeIds, activeInstanceIds) => {
      const apiKey = process.env.AGENTMAIL_API_KEY || process.env.INSTANCE_AGENTMAIL_API_KEY;
      if (!apiKey) {
        console.log("[clean] AGENTMAIL_API_KEY not set — skipping inbox cleanup");
        return [];
      }

      console.log("[clean] Fetching AgentMail inboxes...");
      const res = await fetch("https://api.agentmail.to/v0/inboxes", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        console.error(`[clean] Failed to list inboxes: ${res.status} ${await res.text()}`);
        return [];
      }
      const body = await res.json();
      const inboxes = body?.inboxes ?? body?.data ?? [];
      const localInboxId = process.env.AGENTMAIL_INBOX_ID;

      const managed = inboxes.filter(
        (i) => i.client_id?.startsWith("convos-agent-") || i.username?.startsWith("convos-agent-")
      );
      const orphaned = managed.filter((i) => {
        if (activeIds.has(i.inbox_id)) return false;
        if (i.inbox_id === localInboxId) return false;
        const instanceId = (i.client_id || "").replace("convos-agent-", "");
        if (instanceId && activeInstanceIds.has(instanceId)) return false;
        return true;
      });

      console.log(`[clean] AgentMail: ${inboxes.length} total, ${managed.length} managed, ${orphaned.length} orphaned`);
      return orphaned;
    },

    deleteOrphaned: async (items) => {
      const apiKey = process.env.AGENTMAIL_API_KEY || process.env.INSTANCE_AGENTMAIL_API_KEY;
      for (const inbox of items) {
        const label = inbox.username || inbox.client_id || inbox.inbox_id;
        try {
          const del = await fetch(`https://api.agentmail.to/v0/inboxes/${inbox.inbox_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (del.ok) {
            console.log(`  [deleted] ${label} (${inbox.inbox_id})`);
          } else {
            console.warn(`  [failed]  ${label} (${inbox.inbox_id}) — ${del.status}`);
          }
        } catch (err) {
          console.warn(`  [failed]  ${label} (${inbox.inbox_id}) — ${err.message}`);
        }
      }
    },

    formatItem: (item) => `${item.username || item.client_id || "?"} (${item.inbox_id})`,
  },
});

// ── Service: Telnyx (shared credentials only, no per-instance resources) ──────

register({
  name: "telnyx",

  envVars: () => ({
    TELNYX_API_KEY: getEnv("INSTANCE_TELNYX_API_KEY"),
    TELNYX_PHONE_NUMBER: getEnv("INSTANCE_TELNYX_PHONE_NUMBER"),
    TELNYX_MESSAGING_PROFILE_ID: getEnv("INSTANCE_TELNYX_MESSAGING_PROFILE_ID"),
  }),
});

// ── Service: Wallet (per-instance key generation, no external API) ────────────

register({
  name: "wallet",

  create: async () => {
    const key = "0x" + randomBytes(32).toString("hex");
    return {
      envVars: { PRIVATE_WALLET_KEY: key },
      cache: { privateWalletKey: key },
    };
  },
});
