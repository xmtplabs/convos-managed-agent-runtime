#!/usr/bin/env node
/**
 * Convos runtime skill dispatcher.
 * Usage: node settings.mjs <command>
 *
 * Commands: version, upgrade
 */
import { readFileSync } from "fs";
import { join } from "path";

const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || `${process.env.HOME}/.openclaw`;

const command = process.argv[2];

if (!command) {
  console.error("Usage: node settings.mjs <command>");
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
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Pool returned ${res.status}`);
  return data;
}

function version() {
  const pkgPaths = [
    join(STATE_DIR, "../../package.json"),           // deployed: /app/package.json
    join(process.cwd(), "package.json"),              // local dev
  ];
  let runtimeVersion = "unknown";
  for (const p of pkgPaths) {
    try {
      const pkg = JSON.parse(readFileSync(p, "utf8"));
      if (pkg.version) { runtimeVersion = pkg.version; break; }
    } catch {}
  }
  const image = process.env.RAILWAY_RUNTIME_IMAGE || "unknown";
  console.log(JSON.stringify({
    ok: true,
    action: "version",
    runtimeVersion,
    image,
    instanceId: INSTANCE_ID || "local",
  }, null, 2));
}

async function upgrade() {
  console.log("Requesting Convos runtime upgrade from pool server...");
  const result = await poolSelfRequest("self-upgrade");
  console.log(JSON.stringify({ ok: true, action: "upgrade", image: result.image }, null, 2));
}

try {
  switch (command) {
    case "version":
      version();
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
