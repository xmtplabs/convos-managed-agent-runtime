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

// Proxy mode: route through pool manager
const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const useProxy = !!(POOL_URL && INSTANCE_ID && GATEWAY_TOKEN);

// Direct mode: Telnyx API (local dev — requires TELNYX_* env vars)
const API_KEY = process.env.TELNYX_API_KEY;
const PHONE = process.env.TELNYX_PHONE_NUMBER;

function requireEnv() {
  if (useProxy) return; // proxy mode — pool manager handles auth + phone
  if (!API_KEY) { console.error("SMS service not configured: missing API key"); process.exit(1); }
  if (!PHONE) { console.error("SMS service not configured: missing phone number"); process.exit(1); }
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
  requireEnv();
  const { map } = parseArgs(argv);
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
  requireEnv();
  const { map } = parseArgs(argv);
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

export default async function sms(argv) {
  const [action, ...rest] = argv;

  switch (action) {
    case "send":   return send(rest);
    case "poll":   return poll(rest);
    case "status": return status(rest);
    default:
      console.error("Usage: services.mjs sms <send|poll|status> [options]");
      process.exit(1);
  }
}
