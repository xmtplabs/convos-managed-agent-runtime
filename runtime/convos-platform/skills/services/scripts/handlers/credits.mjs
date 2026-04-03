#!/usr/bin/env node
/**
 * Credits handler — check balance and top up via pool server.
 * Usage:
 *   node services.mjs credits          (check balance)
 *   node services.mjs credits topup    (request top-up)
 *
 * Env: INSTANCE_ID, GATEWAY_TOKEN, POOL_URL (set for pool-managed instances)
 */

const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN;
const POOL_URL = process.env.POOL_URL;

function requirePoolEnv() {
  if (!INSTANCE_ID || !GATEWAY_TOKEN || !POOL_URL) {
    console.error("Credits service not available: this instance is not pool-managed.");
    process.exit(1);
  }
}

async function poolRequest(endpoint) {
  const url = `${POOL_URL}/api/pool/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId: INSTANCE_ID, gatewayToken: GATEWAY_TOKEN }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error || `Pool server returned ${res.status}`);
  }
  return body;
}

async function check() {
  requirePoolEnv();
  const data = await poolRequest("credits-check");
  console.log(JSON.stringify(data, null, 2));
}

async function topup() {
  requirePoolEnv();
  const data = await poolRequest("credits-topup");
  console.log(JSON.stringify(data, null, 2));
}

export default async function credits(argv) {
  const [action] = argv;

  if (!action || action === "check") return check();
  if (action === "topup") return topup();

  console.error("Usage: services.mjs credits [check|topup]");
  process.exit(1);
}
