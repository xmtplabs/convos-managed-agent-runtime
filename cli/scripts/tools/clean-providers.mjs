#!/usr/bin/env node
/**
 * Delete orphaned service resources (inboxes, API keys, etc.) not tied to
 * active instances. Uses the service registry from pool/src/services.js so
 * adding a new service with a `cleanup` block automatically integrates here.
 *
 * Usage: CLEAN_TARGET=all|email|openrouter node clean-providers.mjs
 */

import { createInterface } from "readline";
import { connect, disconnect } from "./lib/db.mjs";
import { getAll } from "../../../pool/src/services.js";

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

  const ids = new Set();
  for (const { node } of edges) {
    if (!node.name.startsWith("convos-agent-") || node.name === "convos-agent-pool-manager") continue;
    if (envId) {
      const envIds = (node.serviceInstances?.edges || []).map((e) => e.node.environmentId);
      if (!envIds.includes(envId)) continue;
    }
    const parts = node.name.replace("convos-agent-", "");
    const id = parts.split("-").pop();
    if (id) ids.add(id);
  }

  console.log(`${TAG} Railway: ${ids.size} active instance(s)`);
  return ids;
}

// ── Env confirmation ─────────────────────────────────────────────────────────

function mask(val) {
  if (!val) return "(not set)";
  if (val.length <= 8) return "***";
  return val.slice(0, 4) + "…" + val.slice(-4);
}

async function confirmEnv(services) {
  const vars = [
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["RAILWAY_API_TOKEN", process.env.RAILWAY_API_TOKEN],
    ["RAILWAY_PROJECT_ID", process.env.RAILWAY_PROJECT_ID],
    ["RAILWAY_ENVIRONMENT_ID", process.env.RAILWAY_ENVIRONMENT_ID],
  ];
  for (const svc of services) {
    for (const [name, val] of svc.cleanup.envVars()) {
      vars.push([name, val]);
    }
  }

  console.log(`\n${TAG} Credentials that will be used:\n`);
  for (const [name, val] of vars) {
    console.log(`  ${name.padEnd(28)} ${mask(val)}`);
  }
  console.log();

  const ok = await confirm("Continue with these credentials? (y/N) ");
  if (!ok) {
    console.log(`${TAG} Aborted.`);
    process.exit(0);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const target = (process.env.CLEAN_TARGET || "all").toLowerCase();

  // Find services with cleanup definitions matching the target
  const allServices = getAll().filter((s) => s.cleanup);
  const targetServices = target === "all"
    ? allServices
    : allServices.filter((s) => s.cleanup.target === target);

  if (targetServices.length === 0) {
    const validTargets = ["all", ...allServices.map((s) => s.cleanup.target)];
    console.error(`${TAG} Unknown target "${target}". Use: ${validTargets.join(", ")}`);
    process.exit(1);
  }

  await confirmEnv(targetServices);

  const pool = connect();
  try {
    // Fetch active IDs from DB + Railway in parallel
    const activeInstanceIds = await getActiveInstanceIds();
    const activeIdsByService = new Map();
    for (const svc of targetServices) {
      const ids = await svc.cleanup.getActiveIds(pool);
      activeIdsByService.set(svc.name, ids);
      console.log(`${TAG} DB: ${ids.size} active ${svc.name} resource(s)`);
    }

    // Discover orphans for each service
    const orphansByService = new Map();
    let totalOrphans = 0;
    for (const svc of targetServices) {
      const activeIds = activeIdsByService.get(svc.name);
      const orphaned = await svc.cleanup.findOrphaned(activeIds, activeInstanceIds);
      orphansByService.set(svc.name, orphaned);
      totalOrphans += orphaned.length;
    }

    if (totalOrphans === 0) {
      console.log(`${TAG} Nothing to clean up.`);
      return;
    }

    // Print what will be deleted
    for (const svc of targetServices) {
      const orphaned = orphansByService.get(svc.name);
      if (orphaned.length === 0) continue;
      console.log(`\n${svc.name} resources to delete (${orphaned.length}):`);
      for (const item of orphaned) {
        console.log(`  - ${svc.cleanup.formatItem(item)}`);
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
    for (const svc of targetServices) {
      const orphaned = orphansByService.get(svc.name);
      if (orphaned.length > 0) await svc.cleanup.deleteOrphaned(orphaned);
    }

    console.log(`${TAG} Done.`);
  } finally {
    await disconnect(pool);
  }
}

main().catch((err) => {
  console.error(`${TAG} Fatal:`, err);
  process.exit(1);
});
