#!/usr/bin/env node
/**
 * Convos runtime skill dispatcher.
 * Usage: node convos-runtime.mjs <command>
 *
 * Commands: version, upgrade
 */

const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

const command = process.argv[2];

if (!command) {
  console.error("Usage: node convos-runtime.mjs <command>");
  console.error("Commands: version, upgrade");
  process.exit(1);
}

async function poolSelfRequest(endpoint) {
  if (!POOL_URL || !INSTANCE_ID || !GATEWAY_TOKEN) {
    throw new Error("Missing POOL_URL, INSTANCE_ID, or OPENCLAW_GATEWAY_TOKEN");
  }
  const res = await fetch(`${POOL_URL}/api/pool/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId: INSTANCE_ID, gatewayToken: GATEWAY_TOKEN }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pool returned ${res.status}`);
  return data;
}

async function version() {
  const result = await poolSelfRequest("self-info");
  console.log(JSON.stringify({
    ok: true,
    action: "version",
    runtimeVersion: result.runtimeVersion,
    runtimeImage: result.runtimeImage,
    latestImage: result.latestImage,
    instanceId: result.instanceId,
  }, null, 2));
}

async function upgrade() {
  if (!process.argv.includes("--confirm")) {
    const info = await poolSelfRequest("self-info");
    console.log(JSON.stringify({
      ok: true,
      action: "upgrade-preview",
      currentImage: info.runtimeImage,
      latestImage: info.latestImage,
      runtimeVersion: info.runtimeVersion,
      message: "Run again with --confirm to proceed. The container will restart and you'll be offline for ~30-60 seconds.",
    }, null, 2));
    return;
  }
  console.log("Requesting Convos runtime upgrade from pool server...");
  const result = await poolSelfRequest("self-upgrade");
  console.log(JSON.stringify({ ok: true, action: "upgrade", image: result.image }, null, 2));
}

try {
  switch (command) {
    case "version":
      await version();
      break;
    case "upgrade":
      await upgrade();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Available: version, upgrade");
      process.exit(1);
  }
} catch (err) {
  console.error(`[convos-runtime/${command}] ${err.message}`);
  process.exit(1);
}
