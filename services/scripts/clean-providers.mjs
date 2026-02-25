#!/usr/bin/env node
/**
 * Delete orphaned AgentMail inboxes and OpenRouter keys not tied to active
 * instances. Queries instance_infra + instance_services tables to build the
 * active set, then lists what will be deleted and asks for confirmation.
 *
 * Usage:
 *   node --env-file=../.env.scaling scripts/clean-providers.mjs
 *   CLEAN_TARGET=email node --env-file=../.env.scaling scripts/clean-providers.mjs
 *   CLEAN_TARGET=openrouter node --env-file=../.env.scaling scripts/clean-providers.mjs
 */

import { createInterface } from "readline";
import pg from "pg";

const TAG = "[clean-providers]";

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

// ── DB helpers ──────────────────────────────────────────────────────────────

function connect() {
  if (!process.env.SERVICE_DATABASE_URL) throw new Error("SERVICE_DATABASE_URL is not set");
  return new pg.Pool({
    connectionString: process.env.SERVICE_DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
}

async function getActiveResourceIds(pool, toolId) {
  const { rows } = await pool.query(
    "SELECT resource_id FROM instance_services WHERE tool_id = $1 AND status = 'active'",
    [toolId],
  );
  return new Set(rows.map((r) => r.resource_id));
}

async function getActiveInstanceIds(pool) {
  const { rows } = await pool.query("SELECT instance_id FROM instance_infra");
  return new Set(rows.map((r) => r.instance_id));
}

// ── AgentMail ───────────────────────────────────────────────────────────────

async function findOrphanedInboxes(activeInboxIds, activeInstanceIds) {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    console.log(`${TAG} AGENTMAIL_API_KEY not set — skipping inbox cleanup`);
    return { orphaned: [], apiKey: null };
  }

  console.log(`${TAG} Fetching AgentMail inboxes...`);
  const res = await fetch("https://api.agentmail.to/v0/inboxes", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`${TAG} Failed to list inboxes: ${res.status} ${await res.text()}`);
    return { orphaned: [], apiKey: null };
  }
  const body = await res.json();
  const inboxes = body?.inboxes ?? body?.data ?? [];

  const managed = inboxes.filter(
    (i) => i.client_id?.startsWith("convos-agent-") || i.username?.startsWith("convos-agent-"),
  );

  const orphaned = managed.filter((i) => {
    if (activeInboxIds.has(i.inbox_id)) return false;
    // Check if the instance ID (from client_id) is still active
    const instanceId = (i.client_id || "").replace("convos-agent-", "");
    if (instanceId && activeInstanceIds.has(instanceId)) return false;
    return true;
  });

  console.log(
    `${TAG} AgentMail: ${inboxes.length} total, ${managed.length} managed, ${orphaned.length} orphaned`,
  );

  return { orphaned, apiKey };
}

async function deleteInboxes(orphaned, apiKey) {
  for (const inbox of orphaned) {
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
}

// ── OpenRouter ──────────────────────────────────────────────────────────────

async function findOrphanedKeys(activeKeyHashes, activeInstanceIds) {
  const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!mgmtKey) {
    console.log(`${TAG} OPENROUTER_MANAGEMENT_KEY not set — skipping key cleanup`);
    return { orphaned: [], mgmtKey: null };
  }

  console.log(`${TAG} Fetching OpenRouter keys...`);
  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    headers: { Authorization: `Bearer ${mgmtKey}` },
  });
  if (!res.ok) {
    console.error(`${TAG} Failed to list keys: ${res.status} ${await res.text()}`);
    return { orphaned: [], mgmtKey: null };
  }
  const body = await res.json();
  const keys = body?.data ?? [];

  const skipName = process.env.OPENROUTER_CLEAN_SKIP_NAME || "dont touch";

  const managed = keys.filter((k) => k.name?.startsWith("convos-agent-"));
  const orphaned = managed.filter((k) => {
    if (!k.hash) return false;
    if (activeKeyHashes.has(k.hash)) return false;
    if (k.name === skipName) return false;
    const instanceId = (k.name || "").replace("convos-agent-", "");
    if (instanceId && activeInstanceIds.has(instanceId)) return false;
    return true;
  });

  console.log(
    `${TAG} OpenRouter: ${keys.length} total, ${managed.length} managed, ${orphaned.length} orphaned`,
  );

  return { orphaned, mgmtKey };
}

async function deleteKeys(orphaned, mgmtKey) {
  for (const key of orphaned) {
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
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const target = (process.env.CLEAN_TARGET || "all").toLowerCase();
  const doEmail = target === "all" || target === "email";
  const doOpenRouter = target === "all" || target === "openrouter";

  if (!doEmail && !doOpenRouter) {
    console.error(`${TAG} Unknown target "${target}". Use: email, openrouter, all`);
    process.exit(1);
  }

  const pool = connect();
  try {
    const [activeInboxIds, activeKeyHashes, activeInstanceIds] = await Promise.all([
      doEmail ? getActiveResourceIds(pool, "agentmail") : Promise.resolve(new Set()),
      doOpenRouter ? getActiveResourceIds(pool, "openrouter") : Promise.resolve(new Set()),
      getActiveInstanceIds(pool),
    ]);
    console.log(
      `${TAG} DB: ${activeInboxIds.size} active inbox(es), ${activeKeyHashes.size} active key(s), ${activeInstanceIds.size} active instance(s)`,
    );

    // Discover orphans
    const email = doEmail
      ? await findOrphanedInboxes(activeInboxIds, activeInstanceIds)
      : { orphaned: [] };
    const router = doOpenRouter
      ? await findOrphanedKeys(activeKeyHashes, activeInstanceIds)
      : { orphaned: [] };

    if (email.orphaned.length === 0 && router.orphaned.length === 0) {
      console.log(`${TAG} Nothing to clean up.`);
      return;
    }

    // Print what will be deleted
    if (email.orphaned.length > 0) {
      console.log(`\nAgentMail inboxes to delete (${email.orphaned.length}):`);
      for (const i of email.orphaned) {
        console.log(`  - ${i.username || i.client_id || "?"} (${i.inbox_id})`);
      }
    }
    if (router.orphaned.length > 0) {
      console.log(`\nOpenRouter keys to delete (${router.orphaned.length}):`);
      for (const k of router.orphaned) {
        console.log(`  - ${k.name} (hash=${k.hash})`);
      }
    }

    // Confirm
    console.log();
    const ok = await confirm("Proceed with deletion? (y/N) ");
    if (!ok) {
      console.log(`${TAG} Aborted.`);
      return;
    }

    // Delete
    if (email.orphaned.length > 0) await deleteInboxes(email.orphaned, email.apiKey);
    if (router.orphaned.length > 0) await deleteKeys(router.orphaned, router.mgmtKey);

    console.log(`${TAG} Done.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`${TAG} Fatal:`, err);
  process.exit(1);
});
