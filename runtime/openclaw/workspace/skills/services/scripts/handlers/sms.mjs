#!/usr/bin/env node
/**
 * SMS handler — send, poll, status via Telnyx REST API.
 * Usage:
 *   node services.mjs sms send --to <phone> --text <msg>
 *   node services.mjs sms poll [--limit 10]
 *   node services.mjs sms status <message-id>
 */

import { readFileSync, writeFileSync } from "fs";

const API_KEY = process.env.TELNYX_API_KEY;
const PHONE = process.env.TELNYX_PHONE_NUMBER;

function requireEnv() {
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

const hdrs = () => ({
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
});

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

  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: hdrs(),
    body: JSON.stringify({ from: PHONE, to, text }),
  });

  const body = await res.json();

  if (!res.ok) {
    const err = body?.errors?.[0];
    console.error(`Send failed (${res.status}): ${err?.detail || err?.title || JSON.stringify(body)}`);
    process.exit(1);
  }

  const msg = body.data;
  console.log(`Sent SMS to ${to}`);
  console.log(`  Message ID: ${msg.id}`);
  console.log(`  From: ${msg.from?.phone_number || PHONE}`);
  console.log(`  Status: ${msg.to?.[0]?.status || msg.status || "queued"}`);
}

async function poll(argv) {
  requireEnv();
  const { map } = parseArgs(argv);
  const limit = parseInt(map.limit, 10) || 10;

  const params = new URLSearchParams({
    "filter[record_type]": "message",
    "filter[direction]": "inbound",
    "filter[cld]": PHONE,
    "page[size]": String(limit),
  });

  const res = await fetch(`https://api.telnyx.com/v2/detail_records?${params}`, { headers: hdrs() });
  const body = await res.json();

  if (!res.ok) {
    const err = body?.errors?.[0];
    console.error(`Failed (${res.status}): ${err?.detail || err?.title || JSON.stringify(body)}`);
    process.exit(1);
  }

  const records = body.data || [];
  console.log(`Inbound messages for ${PHONE}: ${records.length} result(s)\n`);

  for (const r of records) {
    const msgRes = await fetch(`https://api.telnyx.com/v2/messages/${r.id}`, { headers: hdrs() });
    const text = msgRes.ok ? (await msgRes.json()).data?.text : null;

    console.log(`  From: ${r.cli}`);
    console.log(`  Date: ${r.sent_at}`);
    console.log(`  Text: ${text ?? "(unavailable)"}`);
    console.log("");
  }
}

async function status(argv) {
  if (!API_KEY) { console.error("SMS service not configured: missing API key"); process.exit(1); }

  const { positional } = parseArgs(argv);
  const messageId = positional[0];

  if (!messageId) {
    console.error("Usage: services.mjs sms status <message-id>");
    process.exit(1);
  }

  const res = await fetch(`https://api.telnyx.com/v2/messages/${messageId}`, { headers: hdrs() });
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
  requireEnv();
  const { map } = parseArgs(argv);
  const minutes = map.minutes ? parseInt(map.minutes, 10) : null;
  const sinceLast = map["since-last"] !== undefined;
  const limit = parseInt(map.limit, 10) || 5;

  let cutoff;
  if (sinceLast) {
    cutoff = readCursor();
    if (cutoff === 0) cutoff = Date.now() - 30 * 60 * 1000; // first run: 30min fallback
  } else {
    cutoff = Date.now() - (minutes || 30) * 60 * 1000;
  }

  const params = new URLSearchParams({
    "filter[record_type]": "message",
    "filter[direction]": "inbound",
    "filter[cld]": PHONE,
    "page[size]": "20",
  });

  const res = await fetch(`https://api.telnyx.com/v2/detail_records?${params}`, { headers: hdrs() });
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
    const msgRes = await fetch(`https://api.telnyx.com/v2/messages/${r.id}`, { headers: hdrs() });
    const text = msgRes.ok ? (await msgRes.json()).data?.text : null;

    console.log(`From: ${r.cli}`);
    console.log(`Date: ${r.sent_at}`);
    console.log(`Text: ${text ?? "(unavailable)"}`);
    console.log("");
  }
}

export default async function sms(argv) {
  const [action, ...rest] = argv;

  switch (action) {
    case "send":   return send(rest);
    case "poll":   return poll(rest);
    case "status": return status(rest);
    case "recent": return recent(rest);
    default:
      console.error("Usage: services.mjs sms <send|poll|status|recent> [options]");
      process.exit(1);
  }
}
