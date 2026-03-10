#!/usr/bin/env node
/**
 * Settings skill dispatcher.
 * Usage: node settings.mjs <command>
 *
 * Commands: upgrade, reset, clear-memory
 */
import { readdirSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || `${process.env.HOME}/.openclaw`;

const command = process.argv[2];

if (!command) {
  console.error("Usage: node settings.mjs <command>");
  console.error("Commands: upgrade, reset, clear-memory");
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

async function upgrade() {
  console.log("Requesting runtime upgrade from pool server...");
  const result = await poolSelfRequest("self-upgrade");
  console.log(JSON.stringify({ ok: true, action: "upgrade", image: result.image }, null, 2));
}

async function reset() {
  console.log("Requesting instance reset (redeploy) from pool server...");
  const result = await poolSelfRequest("self-reset");
  console.log(JSON.stringify({ ok: true, action: "reset" }, null, 2));
}

function clearMemory() {
  const sessionsDir = join(STATE_DIR, "agents", "main", "sessions");
  if (!existsSync(sessionsDir)) {
    console.log(JSON.stringify({ ok: true, action: "clear-memory", cleared: 0, message: "No sessions directory found" }));
    return;
  }
  const files = readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl") || f === "sessions.json");
  for (const f of files) {
    unlinkSync(join(sessionsDir, f));
  }
  console.log(JSON.stringify({ ok: true, action: "clear-memory", cleared: files.length }));
}

try {
  switch (command) {
    case "upgrade":
      await upgrade();
      break;
    case "reset":
      await reset();
      break;
    case "clear-memory":
      clearMemory();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Available: upgrade, reset, clear-memory");
      process.exit(1);
  }
} catch (err) {
  console.error(`[settings/${command}] ${err.message}`);
  process.exit(1);
}
