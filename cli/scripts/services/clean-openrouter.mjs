#!/usr/bin/env node
/**
 * Find and delete orphaned OpenRouter API keys across ALL Railway environments.
 *
 * Loads all three .env files, collects every agent service name from Railway
 * (all envs), fetches every OpenRouter key (all management keys), then finds
 * keys whose name doesn't match any Railway service.
 *
 * Environment-agnostic: one combined Railway set, one combined key set,
 * one orphan list, one delete pass.
 *
 * Usage: pnpm cli services clean-openrouter
 */

import { createInterface } from "readline";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseDotenv } from "dotenv";
import { isAgentService } from "../../../pool/src/naming.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const TAG = "[clean-openrouter]";
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

// ── OpenRouter ───────────────────────────────────────────────────────────────

async function fetchAllKeys(mgmtKey) {
  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    headers: { Authorization: `Bearer ${mgmtKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter list keys failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  return body?.data ?? [];
}

async function deleteKey(mgmtKey, hash) {
  const res = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${mgmtKey}` },
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
      openrouterMgmtKey: vars.OPENROUTER_MANAGEMENT_KEY,
    });
    console.log(`  ${envName.padEnd(12)} Railway=${mask(vars.RAILWAY_API_TOKEN)}  OpenRouter=${mask(vars.OPENROUTER_MANAGEMENT_KEY)}`);
  }

  if (envConfigs.length === 0) {
    console.error(`\n${TAG} No environment files found.`);
    process.exit(1);
  }

  console.log();
  if (!await confirm("Query Railway + OpenRouter? (y/N) ")) {
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

  // ── Step 2: ALL OpenRouter keys (all mgmt keys, dedup by hash) ─────────

  console.log(`\n${TAG} Step 2 — OpenRouter keys\n`);

  // Collect unique management keys
  const uniqueKeys = new Map(); // mgmtKey → envNames[]
  for (const cfg of envConfigs) {
    if (!cfg.openrouterMgmtKey) continue;
    if (!uniqueKeys.has(cfg.openrouterMgmtKey)) {
      uniqueKeys.set(cfg.openrouterMgmtKey, []);
    }
    uniqueKeys.get(cfg.openrouterMgmtKey).push(cfg.name);
  }

  // Fetch from each unique key, dedup by hash
  const keyMap = new Map(); // hash → { key, mgmtKey }

  for (const [mgmtKey, envNames] of uniqueKeys) {
    try {
      const keys = await fetchAllKeys(mgmtKey);
      console.log(`  ${envNames.join("+")} (${mask(mgmtKey)}): ${keys.length} key(s)`);
      for (const key of keys) {
        if (key.hash && !keyMap.has(key.hash)) {
          keyMap.set(key.hash, { key, mgmtKey });
        }
      }
    } catch (err) {
      console.warn(`  ${envNames.join("+")} (${mask(mgmtKey)}): error — ${err.message}`);
    }
  }

  console.log(`\n  Total unique keys: ${keyMap.size}`);

  // ── Step 3: Cross-reference ────────────────────────────────────────────

  console.log(`\n${TAG} Step 3 — Cross-reference\n`);

  const managed = [];
  const unmanaged = [];

  for (const { key } of keyMap.values()) {
    if (isAgentService(key.name ?? "")) {
      managed.push(key);
    } else {
      unmanaged.push(key);
    }
  }

  const active = [];
  const orphaned = []; // { key, mgmtKey }

  for (const key of managed) {
    if (allRailwayNames.has(key.name)) {
      active.push(key);
    } else {
      const entry = keyMap.get(key.hash);
      orphaned.push({ key, mgmtKey: entry.mgmtKey });
    }
  }

  console.log(`  ${keyMap.size} total keys (${managed.length} managed, ${unmanaged.length} other)`);
  console.log(`  ${active.length} matched to a Railway service`);
  console.log(`  ${orphaned.length} orphaned`);

  if (orphaned.length === 0) {
    console.log(`\n${TAG} No orphaned keys. All clean!`);
    return;
  }

  // ── Show orphans ───────────────────────────────────────────────────────

  console.log(`\n  Orphaned keys (${orphaned.length}):\n`);
  console.log(`  ${pad("NAME", 44)} ${pad("HASH", 68)} CREATED`);
  console.log(`  ${"─".repeat(126)}`);
  for (const { key: k } of orphaned) {
    const name = k.name || "?";
    const hash = k.hash || "?";
    const created = k.created_at ? new Date(k.created_at).toISOString().slice(0, 10) : "?";
    console.log(`  ${pad(name, 44)} ${pad(hash, 68)} ${created}`);
  }

  // ── Confirm and delete ─────────────────────────────────────────────────

  console.log();
  if (!await confirm(`Delete ${orphaned.length} orphaned key(s)? (y/N) `)) {
    console.log(`${TAG} Aborted.`);
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const { key, mgmtKey } of orphaned) {
    if (await deleteKey(mgmtKey, key.hash)) {
      deleted++;
      console.log(`  [deleted] ${key.name} (${key.hash})`);
    } else {
      failed++;
      console.warn(`  [failed]  ${key.name} (${key.hash})`);
    }
  }

  console.log(`\n${TAG} Done. ${deleted} deleted, ${failed} failed.`);
}

main().catch((err) => {
  console.error(`${TAG} Fatal:`, err);
  process.exit(1);
});
