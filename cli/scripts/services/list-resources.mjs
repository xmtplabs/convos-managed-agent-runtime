#!/usr/bin/env node
/**
 * List Railway agent services with their matched OpenRouter key and AgentMail
 * inbox. Matches by canonical service name (see pool/src/naming.js):
 * "convos-agent-<id>-<env>".
 *
 * Usage: pnpm cli --env <env> services list
 */

import { getAgentServiceMap } from "../lib/railway.mjs";

const TAG = "[list-resources]";

// ── Helpers ──────────────────────────────────────────────────────────────────

function pad(str, len) {
  return String(str ?? "").slice(0, len).padEnd(len);
}

// ── Data fetchers ────────────────────────────────────────────────────────────

async function listOpenRouterKeys() {
  const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!mgmtKey) return null;
  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    headers: { Authorization: `Bearer ${mgmtKey}` },
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.data ?? [];
}

async function listAgentMailInboxes() {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) return null;
  const res = await fetch("https://api.agentmail.to/v0/inboxes", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.inboxes ?? body?.data ?? [];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const env = process.env.OPENCLAW_ENV || "dev";
  console.log(`\n${TAG} Environment: ${env.toUpperCase()}\n`);

  // Check required env vars
  const required = {
    RAILWAY_API_TOKEN: process.env.RAILWAY_API_TOKEN,
    RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID,
    OPENROUTER_MANAGEMENT_KEY: process.env.OPENROUTER_MANAGEMENT_KEY,
    AGENTMAIL_API_KEY: process.env.AGENTMAIL_API_KEY,
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.log(`  Missing in .env.${env}: ${missing.join(", ")}\n`);
  }

  if (!process.env.RAILWAY_API_TOKEN || !process.env.RAILWAY_PROJECT_ID) {
    console.error(`  RAILWAY_API_TOKEN and RAILWAY_PROJECT_ID are required.`);
    process.exit(1);
  }

  // Fetch all sources in parallel
  const [railwayServices, orKeys, amInboxes] = await Promise.all([
    getAgentServiceMap(),
    listOpenRouterKeys(),
    listAgentMailInboxes(),
  ]);

  // Build lookup maps by convos-agent-<id> name
  const orKeyByName = new Map();
  if (orKeys) {
    for (const key of orKeys) {
      if (key.name) orKeyByName.set(key.name.toLowerCase(), key);
    }
  }

  const amInboxByName = new Map();
  if (amInboxes) {
    for (const inbox of amInboxes) {
      if (inbox.client_id) amInboxByName.set(inbox.client_id.toLowerCase(), inbox);
      if (inbox.username) amInboxByName.set(inbox.username.toLowerCase(), inbox);
    }
  }

  // Print table
  const COL = { name: 42, email: 44 };

  console.log(
    `  ${pad("SERVICE", COL.name)} ${pad("EMAIL", COL.email)} OPENROUTER`
  );
  console.log(`  ${"─".repeat(COL.name + COL.email + 14)}`);

  if (railwayServices.size === 0) {
    console.log("  (no railway services found)");
  } else {
    for (const [serviceName, svc] of railwayServices) {
      const key = serviceName.toLowerCase();
      const inbox = amInboxByName.get(key);
      const orKey = orKeyByName.get(key);

      const email = inbox
        ? inbox.username || inbox.inbox_id || "yes"
        : amInboxes === null ? "—" : "none";
      const orHash = orKey
        ? orKey.hash || "yes"
        : orKeys === null ? "—" : "none";

      console.log(
        `  ${pad(svc.name, COL.name)} ${pad(email, COL.email)} ${orHash}`
      );
    }
  }

  console.log(`\n  ${railwayServices.size} service(s)${orKeys ? ` | ${orKeys.length} OR keys total` : ""}${amInboxes ? ` | ${amInboxes.length} inboxes total` : ""}`);
  console.log();
}

main().catch((err) => {
  console.error(`${TAG} Fatal:`, err);
  process.exit(1);
});
