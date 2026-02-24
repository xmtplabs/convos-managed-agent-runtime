#!/usr/bin/env node
/**
 * Delete orphaned AgentMail inboxes and OpenRouter keys not tied to active
 * instances. Queries both the DB (claimed instances) and Railway (warm/idle
 * instances) to build the active set, then lists what will be deleted and
 * asks for confirmation.
 */

import { createInterface } from "readline";
import { connect, getActiveInboxIds, getActiveKeyHashes, disconnect } from "./lib/db.mjs";

const TAG = "[clean-providers]";
const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

// ── Railway: find active instance IDs (warm + claimed) ───────────────────────

async function getActiveInstanceIds() {
  const token = process.env.RAILWAY_API_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  const envId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!token || !projectId) {
    console.log(`${TAG} RAILWAY_API_TOKEN/RAILWAY_PROJECT_ID not set — using DB only (warm instances not protected)`);
    return new Set();
  }

  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `query($id: String!) {
        project(id: $id) {
          services(first: 500) {
            edges { node { id name serviceInstances { edges { node { environmentId } } } } }
          }
        }
      }`,
      variables: { id: projectId },
    }),
  });

  const body = await res.json();
  const edges = body?.data?.project?.services?.edges ?? [];

  // Filter to convos-agent-* services in our environment, extract instance IDs
  const ids = new Set();
  for (const { node } of edges) {
    if (!node.name.startsWith("convos-agent-") || node.name === "convos-agent-pool-manager") continue;
    if (envId) {
      const envIds = (node.serviceInstances?.edges || []).map((e) => e.node.environmentId);
      if (!envIds.includes(envId)) continue;
    }
    // Instance ID is the suffix after "convos-agent-" (before any rename with agent name)
    // For warm instances: "convos-agent-{id}", for claimed: "convos-agent-{agentName}-{id}"
    const parts = node.name.replace("convos-agent-", "");
    // The nanoid is the last 12-char segment
    const id = parts.split("-").pop();
    if (id) ids.add(id);
  }

  console.log(`${TAG} Railway: ${ids.size} active instance(s)`);
  return ids;
}

// ── AgentMail ────────────────────────────────────────────────────────────────

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
    (i) => i.client_id?.startsWith("convos-agent-") || i.username?.startsWith("convos-agent-")
  );

  // Skip: inboxes in DB, inboxes whose instance is still on Railway, local dev inbox
  const localInboxId = process.env.AGENTMAIL_INBOX_ID;
  const orphaned = managed.filter((i) => {
    if (activeInboxIds.has(i.inbox_id)) return false;
    if (i.inbox_id === localInboxId) return false;
    // Check if the instance ID (from client_id) is still running on Railway
    const instanceId = (i.client_id || "").replace("convos-agent-", "");
    if (instanceId && activeInstanceIds.has(instanceId)) return false;
    return true;
  });

  console.log(
    `${TAG} AgentMail: ${inboxes.length} total, ${managed.length} managed, ${orphaned.length} orphaned`
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

// ── OpenRouter ───────────────────────────────────────────────────────────────

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
    // Check if the instance ID (from key name) is still running on Railway
    const instanceId = (k.name || "").replace("convos-agent-", "");
    if (instanceId && activeInstanceIds.has(instanceId)) return false;
    return true;
  });

  console.log(
    `${TAG} OpenRouter: ${keys.length} total, ${managed.length} managed, ${orphaned.length} orphaned`
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

// ── Main ─────────────────────────────────────────────────────────────────────

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
      doEmail ? getActiveInboxIds(pool) : Promise.resolve(new Set()),
      doOpenRouter ? getActiveKeyHashes(pool) : Promise.resolve(new Set()),
      getActiveInstanceIds(),
    ]);
    console.log(
      `${TAG} DB: ${activeInboxIds.size} active inbox(es), ${activeKeyHashes.size} active key(s)`
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
    await disconnect(pool);
  }
}

main().catch((err) => {
  console.error(`${TAG} Fatal:`, err);
  process.exit(1);
});
