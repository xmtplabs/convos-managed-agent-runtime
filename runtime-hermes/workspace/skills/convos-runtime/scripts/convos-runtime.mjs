#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const command = process.argv[2];

const __dirname = dirname(fileURLToPath(import.meta.url));
const candidateRoots = [
  process.env.CONVOS_REPO_ROOT,
  resolve(__dirname, "../../../.."),
  resolve(__dirname, "../../../../.."),
].filter(Boolean);

if (!command) {
  console.error("Usage: node convos-runtime.mjs <command>");
  console.error("Commands: version, upgrade");
  process.exit(1);
}

function getLocalVersion() {
  for (const root of candidateRoots) {
    const pkgPath = join(root, "runtime", "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.version) return pkg.version;
    } catch {}
  }

  return null;
}

function localVersionPayload() {
  return {
    runtimeVersion: getLocalVersion(),
    runtimeImage: process.env.RUNTIME_IMAGE || "local/dev",
    latestImage: process.env.RUNTIME_IMAGE || "local/dev",
    instanceId: INSTANCE_ID || null,
  };
}

async function poolSelfRequest(endpoint) {
  if (!POOL_URL || !INSTANCE_ID || !GATEWAY_TOKEN) {
    throw new Error("Missing POOL_URL, INSTANCE_ID, or OPENCLAW_GATEWAY_TOKEN");
  }

  const response = await fetch(`${POOL_URL}/api/pool/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId: INSTANCE_ID, gatewayToken: GATEWAY_TOKEN }),
    signal: AbortSignal.timeout(10_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Pool returned ${response.status}`);
  }

  return data;
}

async function version() {
  if (!POOL_URL || !INSTANCE_ID || !GATEWAY_TOKEN) {
    console.log(JSON.stringify({ ok: true, action: "version", ...localVersionPayload() }, null, 2));
    return;
  }

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
  if (!POOL_URL || !INSTANCE_ID || !GATEWAY_TOKEN) {
    console.log(JSON.stringify({
      ok: true,
      action: "upgrade-preview",
      ...localVersionPayload(),
      message: "This local runtime is not pool-managed. In production, upgrading redeploys the latest Convos runtime container image.",
    }, null, 2));
    return;
  }

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
} catch (error) {
  console.error(`[convos-runtime/${command}] ${error.message}`);
  process.exit(1);
}
