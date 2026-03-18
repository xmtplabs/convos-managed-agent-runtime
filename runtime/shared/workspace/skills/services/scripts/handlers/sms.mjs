#!/usr/bin/env node
/**
 * SMS handler — send, poll, status via Telnyx REST API.
 *
 * When POOL_URL and INSTANCE_ID are set, calls are proxied through the pool
 * manager (no API key needed on the instance). Otherwise falls back to direct
 * Telnyx API calls for local development.
 *
 * Usage:
 *   node services.mjs sms send --to <phone> --text <msg>
 *   node services.mjs sms poll [--limit 10]
 *   node services.mjs sms status <message-id>
 */

import { readFileSync, writeFileSync } from "fs";

// Proxy mode: route through pool manager
const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const useProxy = !!(POOL_URL && INSTANCE_ID && GATEWAY_TOKEN);

// 10DLC compliance: keywords handled by the system — filter from poll results
const SMS_KEYWORDS = new Set([
  "STOP", "CANCEL", "END", "QUIT", "UNSUBSCRIBE",
  "START", "YES",
  "HELP", "INFO",
]);

// Direct mode: Telnyx API (local dev — requires TELNYX_* env vars)
const API_KEY = process.env.TELNYX_API_KEY;
const PHONE = process.env.TELNYX_PHONE_NUMBER;

/** Ensure SMS is available. Use --no-provision to silently exit when not provisioned. */
async function requireEnv({ noProvision = false } = {}) {
  if (!useProxy) {
    if (!API_KEY) { console.error("SMS service not configured: missing API key"); process.exit(1); }
    if (!PHONE) { console.error("SMS service not configured: missing phone number"); process.exit(1); }
    return;
  }
  // Proxy mode — check if phone exists
  const infoRes = await fetch(`${POOL_URL}/api/proxy/info`, {
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}` },
  });
  if (!infoRes.ok) return; // let the actual call fail with a clear error
  const info = await infoRes.json();
  if (info.phone) return; // already provisioned

  // Not provisioned — either skip silently or fail
  if (noProvision) {
    process.exit(0);
  }
  console.error("SMS not provisioned. Use the provision endpoint first.");
  process.exit(1);
}

function parseArgs(argv) {
  const map = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        map[key] = argv[++i];
      } else {
        map[key] = true;
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { map, positional };
}

// Proxy headers: instance auth
function proxyHeaders() {
  return {
    Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// Direct headers: Telnyx API key
function directHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function send(argv) {
  const { map, positional } = parseArgs(argv);
  await requireEnv({ noProvision: !!map["no-provision"] });
  const to = map.to;
  const text = map.text;

  if (!to || text === undefined) {
    console.error("Usage: services.mjs sms send --to <phone> --text <message>");
    process.exit(1);
  }

  if (!to.startsWith("+1")) {
    console.error("Only US numbers (+1) are supported.");
    process.exit(1);
  }

  let res;
  if (useProxy) {
    // Proxy injects `from` server-side
    res = await fetch(`${POOL_URL}/api/proxy/sms/send`, {
      method: "POST",
      headers: proxyHeaders(),
      body: JSON.stringify({ to, text }),
    });
  } else {
    res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: directHeaders(),
      body: JSON.stringify({ from: PHONE, to, text }),
    });
  }

  const body = await res.json();

  if (!res.ok) {
    const err = body?.errors?.[0];
    console.error(`Send failed (${res.status}): ${err?.detail || err?.title || JSON.stringify(body)}`);
    process.exit(1);
  }

  const msg = body.data;
  console.log(`Sent SMS to ${to}`);
  console.log(`  Message ID: ${msg.id}`);
  console.log(`  From: ${msg.from?.phone_number || PHONE || "(proxy)"}`);
  console.log(`  Status: ${msg.to?.[0]?.status || msg.status || "queued"}`);
}

async function poll(argv) {
  const { map, positional } = parseArgs(argv);
  await requireEnv({ noProvision: !!map["no-provision"] });
  const limit = parseInt(map.limit, 10) || 10;

  let res;
  if (useProxy) {
    // Proxy injects phone filter server-side
    const params = new URLSearchParams({
      "filter[record_type]": "message",
      "filter[direction]": "inbound",
      "page[size]": String(limit),
    });
    res = await fetch(`${POOL_URL}/api/proxy/sms/records?${params}`, { headers: proxyHeaders() });
  } else {
    const params = new URLSearchParams({
      "filter[record_type]": "message",
      "filter[direction]": "inbound",
      "filter[cld]": PHONE,
      "page[size]": String(limit),
    });
    res = await fetch(`https://api.telnyx.com/v2/detail_records?${params}`, { headers: directHeaders() });
  }

  const body = await res.json();

  if (!res.ok) {
    const err = body?.errors?.[0];
    console.error(`Failed (${res.status}): ${err?.detail || err?.title || JSON.stringify(body)}`);
    process.exit(1);
  }

  const records = body.data || [];
  const displayPhone = PHONE || "(proxy)";
  console.log(`Inbound messages for ${displayPhone}: ${records.length} result(s)\n`);

  for (const r of records) {
    let text = null;
    if (useProxy) {
      const msgRes = await fetch(`${POOL_URL}/api/proxy/sms/messages/${r.id}`, { headers: proxyHeaders() });
      text = msgRes.ok ? (await msgRes.json()).data?.text : null;
    } else {
      const msgRes = await fetch(`https://api.telnyx.com/v2/messages/${r.id}`, { headers: directHeaders() });
      text = msgRes.ok ? (await msgRes.json()).data?.text : null;
    }

    // Skip compliance keywords — handled automatically by the system
    if (text && SMS_KEYWORDS.has(text.trim().toUpperCase())) continue;

    console.log(`  From: ${r.cli}`);
    console.log(`  Date: ${r.sent_at}`);
    console.log(`  Text: ${text ?? "(unavailable)"}`);
    console.log("");
  }
}

async function status(argv) {
  if (!useProxy && !API_KEY) { console.error("SMS service not configured: missing API key"); process.exit(1); }

  const { positional } = parseArgs(argv);
  const messageId = positional[0];

  if (!messageId) {
    console.error("Usage: services.mjs sms status <message-id>");
    process.exit(1);
  }

  let res;
  if (useProxy) {
    res = await fetch(`${POOL_URL}/api/proxy/sms/messages/${messageId}`, { headers: proxyHeaders() });
  } else {
    res = await fetch(`https://api.telnyx.com/v2/messages/${messageId}`, { headers: directHeaders() });
  }

  const body = await res.json();

  if (!res.ok) {
    const err = body?.errors?.[0];
    console.error(`Failed (${res.status}): ${err?.detail || err?.title || JSON.stringify(body)}`);
    process.exit(1);
  }

  const msg = body.data;
  const recipient = msg.to?.[0];
  console.log(`Message ${msg.id}`);
  console.log(`  From: ${msg.from?.phone_number || "N/A"}`);
  console.log(`  To: ${recipient?.phone_number || "N/A"}`);
  console.log(`  Status: ${recipient?.status || msg.status || "unknown"}`);
  console.log(`  Direction: ${msg.direction || "N/A"}`);
  if (msg.text) console.log(`  Text: ${msg.text}`);
  if (msg.created_at) console.log(`  Created: ${msg.created_at}`);
  if (msg.completed_at) console.log(`  Completed: ${msg.completed_at}`);
}

const SMS_CURSOR_FILE = "/tmp/.heartbeat-sms-cursor";

function readCursor() {
  try {
    const ts = parseInt(readFileSync(SMS_CURSOR_FILE, "utf8").trim(), 10);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeCursor(ts) {
  try { writeFileSync(SMS_CURSOR_FILE, String(ts), "utf8"); } catch {}
}

async function recent(argv) {
  const { map, positional } = parseArgs(argv);
  await requireEnv({ noProvision: !!map["no-provision"] });
  const minutes = map.minutes ? parseInt(map.minutes, 10) : null;
  const sinceLast = !!map["since-last"];
  const limit = parseInt(map.limit, 10) || 5;

  let cutoff;
  if (sinceLast) {
    cutoff = readCursor();
    if (cutoff === 0) cutoff = Date.now() - 30 * 60 * 1000; // first run: 30min fallback
  } else {
    cutoff = Date.now() - (minutes || 30) * 60 * 1000;
  }

  let res;
  if (useProxy) {
    const params = new URLSearchParams({
      "filter[record_type]": "message",
      "filter[direction]": "inbound",
      "page[size]": "20",
    });
    res = await fetch(`${POOL_URL}/api/proxy/sms/records?${params}`, { headers: proxyHeaders() });
  } else {
    const params = new URLSearchParams({
      "filter[record_type]": "message",
      "filter[direction]": "inbound",
      "filter[cld]": PHONE,
      "page[size]": "20",
    });
    res = await fetch(`https://api.telnyx.com/v2/detail_records?${params}`, { headers: directHeaders() });
  }

  const body = await res.json();

  if (!res.ok) {
    const err = body?.errors?.[0];
    console.error(`Failed (${res.status}): ${err?.detail || err?.title || JSON.stringify(body)}`);
    process.exit(1);
  }

  const all = body.data || [];
  const records = all.filter((r) => {
    const ts = r.sent_at ? new Date(r.sent_at).getTime() : 0;
    return ts > cutoff;
  }).slice(0, limit);

  if (sinceLast && records.length > 0) {
    // Advance cursor to the newest message we reported
    const newest = records.reduce((max, r) => {
      const ts = r.sent_at ? new Date(r.sent_at).getTime() : 0;
      return ts > max ? ts : max;
    }, cutoff);
    writeCursor(newest);
  }

  if (records.length === 0) {
    console.log("No new SMS.");
    return;
  }

  for (const r of records) {
    let text = null;
    if (useProxy) {
      const msgRes = await fetch(`${POOL_URL}/api/proxy/sms/messages/${r.id}`, { headers: proxyHeaders() });
      text = msgRes.ok ? (await msgRes.json()).data?.text : null;
    } else {
      const msgRes = await fetch(`https://api.telnyx.com/v2/messages/${r.id}`, { headers: directHeaders() });
      text = msgRes.ok ? (await msgRes.json()).data?.text : null;
    }

    // Skip compliance keywords — handled automatically by the system
    if (text && SMS_KEYWORDS.has(text.trim().toUpperCase())) continue;

    console.log(`From: ${r.cli}`);
    console.log(`Date: ${r.sent_at}`);
    console.log(`Text: ${text ?? "(unavailable)"}`);
    console.log("");
  }
}

async function provision() {
  if (!useProxy) {
    console.log("SMS provisioning is only available in proxy mode (pool-managed instances).");
    process.exit(1);
  }
  // Check if already provisioned
  const infoRes = await fetch(`${POOL_URL}/api/proxy/info`, {
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}` },
  });
  if (infoRes.ok) {
    const info = await infoRes.json();
    if (info.phone) {
      console.log(`SMS already provisioned: ${info.phone}`);
      return;
    }
  }
  // Provision
  const provRes = await fetch(`${POOL_URL}/api/proxy/sms/provision`, {
    method: "POST",
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}`, "Content-Type": "application/json" },
  });
  if (!provRes.ok) {
    const err = await provRes.json().catch(() => ({}));
    console.error(`SMS provisioning failed: ${err.error || provRes.status}`);
    process.exit(1);
  }
  const result = await provRes.json();
  console.log(`SMS provisioned: ${result.phone}`);
}

export default async function sms(argv) {
  const [action, ...rest] = argv;

  switch (action) {
    case "provision": return provision();
    case "send":   return send(rest);
    case "poll":   return poll(rest);
    case "status": return status(rest);
    case "recent": return recent(rest);
    default:
      console.error("Usage: services.mjs sms <provision|send|poll|status|recent> [options]");
      process.exit(1);
  }
}
