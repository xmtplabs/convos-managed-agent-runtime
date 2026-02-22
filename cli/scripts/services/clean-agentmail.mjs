#!/usr/bin/env node
/**
 * Find and delete orphaned AgentMail inboxes across ALL Railway environments.
 *
 * Loads all three .env files, collects every agent service name from Railway
 * (all envs), fetches every AgentMail inbox (all API keys, paginated), then
 * finds inboxes whose client_id doesn't match any Railway service.
 *
 * Environment-agnostic: one combined Railway set, one combined inbox set,
 * one orphan list, one delete pass.
 *
 * Usage: pnpm cli services clean-agentmail
 */

import { createInterface } from "readline";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseDotenv } from "dotenv";
import { isAgentService } from "../../../pool/src/naming.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const TAG = "[clean-agentmail]";
const ENVS = ["dev", "staging", "production"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

function mask(val) {
  if (!val) return "(not set)";
  if (val.length <= 8) return "***";
  return val.slice(0, 4) + "…" + val.slice(-4);
}

function pad(str, len) {
  return String(str ?? "").slice(0, len).padEnd(len);
}

function loadEnvFile(envName) {
  try {
    return parseDotenv(readFileSync(resolve(ROOT, `.env.${envName}`)));
  } catch {
    return null;
  }
}

// ── Railway ──────────────────────────────────────────────────────────────────

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

async function gql(token, query, variables = {}) {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`Railway API: ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function resolveEnvId(token, projectId, envName) {
  const data = await gql(token, `query($id: String!) {
    project(id: $id) { environments { edges { node { id name } } } }
  }`, { id: projectId });
  const envs = data?.project?.environments?.edges ?? [];
  const match = envs.find((e) => e.node.name.toLowerCase() === envName.toLowerCase());
  return match?.node.id ?? null;
}

async function getAgentServiceNames(token, projectId, envId) {
  const data = await gql(token, `query($id: String!) {
    project(id: $id) {
      services(first: 500) {
        edges { node { id name serviceInstances { edges { node { environmentId } } } } }
      }
    }
  }`, { id: projectId });

  const edges = data?.project?.services?.edges ?? [];
  const names = [];
  for (const { node } of edges) {
    if (!isAgentService(node.name)) continue;
    if (envId) {
      const envIds = (node.serviceInstances?.edges || []).map((e) => e.node.environmentId);
      if (!envIds.includes(envId)) continue;
    }
    names.push(node.name);
  }
  return names;
}

// ── AgentMail ────────────────────────────────────────────────────────────────

async function fetchAllInboxes(apiKey) {
  const all = [];
  let pageToken = undefined;

  while (true) {
    const url = new URL("https://api.agentmail.to/v0/inboxes");
    url.searchParams.set("limit", "150");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AgentMail list failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const body = await res.json();
    const inboxes = body?.inboxes ?? body?.data ?? [];
    all.push(...inboxes);

    pageToken = body?.next_page_token;
    if (!pageToken || inboxes.length === 0) break;
  }

  return all;
}

async function deleteInbox(apiKey, inboxId) {
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${inboxId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return res.ok;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Load env files ──────────────────────────────────────────────────────

  console.log(`\n${TAG} Loading environment files...\n`);

  const envConfigs = [];
  for (const envName of ENVS) {
    const vars = loadEnvFile(envName);
    if (!vars) {
      console.log(`  ${envName.padEnd(12)} .env.${envName} not found — skipped`);
      continue;
    }
    envConfigs.push({
      name: envName,
      railwayToken: vars.RAILWAY_API_TOKEN,
      railwayProjectId: vars.RAILWAY_PROJECT_ID,
      railwayEnvName: vars.RAILWAY_ENVIRONMENT_NAME || envName,
      agentmailApiKey: vars.AGENTMAIL_API_KEY,
    });
    console.log(`  ${envName.padEnd(12)} Railway=${mask(vars.RAILWAY_API_TOKEN)}  AgentMail=${mask(vars.AGENTMAIL_API_KEY)}`);
  }

  if (envConfigs.length === 0) {
    console.error(`\n${TAG} No environment files found.`);
    process.exit(1);
  }

  console.log();
  if (!await confirm("Query Railway + AgentMail? (y/N) ")) {
    console.log(`${TAG} Aborted.`);
    process.exit(0);
  }

  // ── Step 1: ALL Railway service names (all envs → one Set) ─────────────

  console.log(`\n${TAG} Step 1 — Railway services\n`);

  const allRailwayNames = new Set();

  for (const cfg of envConfigs) {
    if (!cfg.railwayToken || !cfg.railwayProjectId) {
      console.log(`  ${cfg.name}: missing credentials — skipped`);
      continue;
    }
    try {
      const envId = await resolveEnvId(cfg.railwayToken, cfg.railwayProjectId, cfg.railwayEnvName);
      if (!envId) {
        console.log(`  ${cfg.name}: env "${cfg.railwayEnvName}" not found — skipped`);
        continue;
      }
      const names = await getAgentServiceNames(cfg.railwayToken, cfg.railwayProjectId, envId);
      for (const n of names) allRailwayNames.add(n);
      console.log(`  ${cfg.name}: ${names.length} service(s)`);
    } catch (err) {
      console.warn(`  ${cfg.name}: error — ${err.message}`);
    }
  }

  console.log(`\n  Total unique Railway names: ${allRailwayNames.size}`);

  // ── Step 2: ALL AgentMail inboxes (all API keys, dedup by inbox_id) ────

  console.log(`\n${TAG} Step 2 — AgentMail inboxes\n`);

  // Collect unique API keys
  const uniqueKeys = new Map(); // apiKey → envNames[]
  for (const cfg of envConfigs) {
    if (!cfg.agentmailApiKey) continue;
    if (!uniqueKeys.has(cfg.agentmailApiKey)) {
      uniqueKeys.set(cfg.agentmailApiKey, []);
    }
    uniqueKeys.get(cfg.agentmailApiKey).push(cfg.name);
  }

  // Fetch from each unique key, dedup by inbox_id into one map
  // Track which API key owns each inbox (for deletion)
  const inboxMap = new Map(); // inbox_id → { inbox, apiKey }

  for (const [apiKey, envNames] of uniqueKeys) {
    try {
      const inboxes = await fetchAllInboxes(apiKey);
      console.log(`  ${envNames.join("+")} (${mask(apiKey)}): ${inboxes.length} inbox(es)`);
      for (const inbox of inboxes) {
        if (!inboxMap.has(inbox.inbox_id)) {
          inboxMap.set(inbox.inbox_id, { inbox, apiKey });
        }
      }
    } catch (err) {
      console.warn(`  ${envNames.join("+")} (${mask(apiKey)}): error — ${err.message}`);
    }
  }

  console.log(`\n  Total unique inboxes: ${inboxMap.size}`);

  // ── Step 3: Cross-reference ────────────────────────────────────────────

  console.log(`\n${TAG} Step 3 — Cross-reference\n`);

  const managed = [];
  const unmanaged = [];

  for (const { inbox } of inboxMap.values()) {
    const cid = inbox.client_id ?? "";
    const uname = inbox.username ?? "";
    if (isAgentService(cid) || isAgentService(uname)) {
      managed.push(inbox);
    } else {
      unmanaged.push(inbox);
    }
  }

  const active = [];
  const orphaned = []; // { inbox, apiKey }

  for (const inbox of managed) {
    const name = inbox.client_id || inbox.username || "";
    if (allRailwayNames.has(name)) {
      active.push(inbox);
    } else {
      // Need apiKey for deletion — look it up from inboxMap
      const entry = inboxMap.get(inbox.inbox_id);
      orphaned.push({ inbox, apiKey: entry.apiKey });
    }
  }

  console.log(`  ${inboxMap.size} total inboxes (${managed.length} managed, ${unmanaged.length} other)`);
  console.log(`  ${active.length} matched to a Railway service`);
  console.log(`  ${orphaned.length} orphaned`);

  if (orphaned.length === 0) {
    console.log(`\n${TAG} No orphaned inboxes. All clean!`);
    return;
  }

  // ── Show orphans ───────────────────────────────────────────────────────

  console.log(`\n  Orphaned inboxes (${orphaned.length}):\n`);
  console.log(`  ${pad("CLIENT_ID", 44)} ${pad("EMAIL", 48)} CREATED`);
  console.log(`  ${"─".repeat(106)}`);
  for (const { inbox: i } of orphaned) {
    const cid = i.client_id || i.username || "?";
    const email = i.inbox_id || "?";
    const created = i.created_at ? new Date(i.created_at).toISOString().slice(0, 10) : "?";
    console.log(`  ${pad(cid, 44)} ${pad(email, 48)} ${created}`);
  }

  // ── Confirm and delete ─────────────────────────────────────────────────

  console.log();
  if (!await confirm(`Delete ${orphaned.length} orphaned inbox(es)? (y/N) `)) {
    console.log(`${TAG} Aborted.`);
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const { inbox, apiKey } of orphaned) {
    const label = inbox.client_id || inbox.username || inbox.inbox_id;
    if (await deleteInbox(apiKey, inbox.inbox_id)) {
      deleted++;
      console.log(`  [deleted] ${label}`);
    } else {
      failed++;
      console.warn(`  [failed]  ${label}`);
    }
  }

  console.log(`\n${TAG} Done. ${deleted} deleted, ${failed} failed.`);
}

main().catch((err) => {
  console.error(`${TAG} Fatal:`, err);
  process.exit(1);
});
