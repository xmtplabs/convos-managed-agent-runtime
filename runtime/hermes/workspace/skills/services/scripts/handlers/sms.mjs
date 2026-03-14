#!/usr/bin/env node
/**
 * SMS handler — send, poll, status via Telnyx REST API.
 *
 * In local Hermes eval mode (HERMES_EVAL_LOCAL_SERVICES=1), direct mode uses a
 * deterministic local store instead of external providers so evals stay stable.
 */

import { readFileSync, writeFileSync } from "fs";
import {
  getLocalSms,
  listLocalSms,
  listRecentLocalSms,
  localPhoneNumber,
  localServicesEnabled,
  recordLocalSms,
} from "./local-store.mjs";

const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const useProxy = !!(POOL_URL && INSTANCE_ID && GATEWAY_TOKEN);

const API_KEY = process.env.TELNYX_API_KEY;
const PHONE = process.env.TELNYX_PHONE_NUMBER;
const MESSAGING_PROFILE_ID = process.env.TELNYX_MESSAGING_PROFILE_ID;

async function requireEnv() {
  if (localServicesEnabled() && !useProxy) return;

  if (!useProxy) {
    if (!API_KEY) { console.error("SMS service not configured: missing API key"); process.exit(1); }
    if (!PHONE) { console.error("SMS service not configured: missing phone number"); process.exit(1); }
    return;
  }

  const infoRes = await fetch(`${POOL_URL}/api/proxy/info`, {
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}` },
  });
  if (!infoRes.ok) return;
  const info = await infoRes.json();
  if (info.phone) return;

  console.log("SMS not yet provisioned — requesting phone number...");
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

function parseArgs(argv) {
  const map = {};
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index].startsWith("--")) {
      const key = argv[index].slice(2);
      if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
        map[key] = argv[++index];
      } else {
        map[key] = true;
      }
    } else {
      positional.push(argv[index]);
    }
  }
  return { map, positional };
}

function proxyHeaders() {
  return {
    Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function directHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function send(argv) {
  await requireEnv();
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

  if (localServicesEnabled() && !useProxy) {
    const msg = recordLocalSms({ to, text });
    console.log(`Sent SMS to ${to}`);
    console.log(`  Message ID: ${msg.id}`);
    console.log(`  From: ${localPhoneNumber()}`);
    console.log("  Status: queued");
    return;
  }

  let res;
  if (useProxy) {
    res = await fetch(`${POOL_URL}/api/proxy/sms/send`, {
      method: "POST",
      headers: proxyHeaders(),
      body: JSON.stringify({ to, text }),
    });
  } else {
    const payload = { from: PHONE, to, text };
    if (MESSAGING_PROFILE_ID) payload.messaging_profile_id = MESSAGING_PROFILE_ID;
    res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: directHeaders(),
      body: JSON.stringify(payload),
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
  await requireEnv();
  const { map } = parseArgs(argv);
  const limit = parseInt(map.limit, 10) || 10;

  if (localServicesEnabled() && !useProxy) {
    const records = listLocalSms({ limit });
    console.log(`Inbound messages for ${localPhoneNumber()}: ${records.length} result(s)\n`);
    for (const record of records) {
      console.log(`  From: ${record.cli}`);
      console.log(`  Date: ${record.sent_at}`);
      console.log(`  Text: ${record.text}`);
      console.log("");
    }
    return;
  }

  let res;
  if (useProxy) {
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
  console.log(`Inbound messages for ${PHONE || "(proxy)"}: ${records.length} result(s)\n`);
  for (const record of records) {
    let text = null;
    if (useProxy) {
      const msgRes = await fetch(`${POOL_URL}/api/proxy/sms/messages/${record.id}`, { headers: proxyHeaders() });
      text = msgRes.ok ? (await msgRes.json()).data?.text : null;
    } else {
      const msgRes = await fetch(`https://api.telnyx.com/v2/messages/${record.id}`, { headers: directHeaders() });
      text = msgRes.ok ? (await msgRes.json()).data?.text : null;
    }

    console.log(`  From: ${record.cli}`);
    console.log(`  Date: ${record.sent_at}`);
    console.log(`  Text: ${text ?? "(unavailable)"}`);
    console.log("");
  }
}

async function status(argv) {
  const { positional } = parseArgs(argv);
  const messageId = positional[0];

  if (!messageId) {
    console.error("Usage: services.mjs sms status <message-id>");
    process.exit(1);
  }

  if (localServicesEnabled() && !useProxy) {
    const msg = getLocalSms(messageId);
    if (!msg) {
      console.error(`Failed (404): local message ${messageId} not found`);
      process.exit(1);
    }
    console.log(`Message ${msg.id}`);
    console.log(`  From: ${msg.from}`);
    console.log(`  To: ${msg.to}`);
    console.log(`  Status: ${msg.status}`);
    console.log(`  Direction: ${msg.direction}`);
    console.log(`  Text: ${msg.text}`);
    console.log(`  Created: ${msg.sent_at}`);
    return;
  }

  if (!useProxy && !API_KEY) {
    console.error("SMS service not configured: missing API key");
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
  await requireEnv();
  const { map } = parseArgs(argv);
  const minutes = map.minutes ? parseInt(map.minutes, 10) : null;
  const sinceLast = map["since-last"] !== undefined;
  const limit = parseInt(map.limit, 10) || 5;

  let cutoff;
  if (sinceLast) {
    cutoff = readCursor();
    if (cutoff === 0) cutoff = Date.now() - 30 * 60 * 1000;
  } else {
    cutoff = Date.now() - (minutes || 30) * 60 * 1000;
  }

  let records;
  if (localServicesEnabled() && !useProxy) {
    records = listRecentLocalSms({ cutoff, limit });
  } else {
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

    records = (body.data || []).filter((record) => {
      const ts = record.sent_at ? new Date(record.sent_at).getTime() : 0;
      return ts > cutoff;
    }).slice(0, limit);
  }

  if (sinceLast && records.length > 0) {
    const newest = records.reduce((max, record) => {
      const ts = record.sent_at ? new Date(record.sent_at).getTime() : 0;
      return ts > max ? ts : max;
    }, cutoff);
    writeCursor(newest);
  }

  if (records.length === 0) {
    console.log("No new SMS.");
    return;
  }

  for (const record of records) {
    const text = localServicesEnabled() && !useProxy
      ? record.text
      : (() => null)();

    if (!(localServicesEnabled() && !useProxy)) {
      let msgRes;
      if (useProxy) {
        msgRes = await fetch(`${POOL_URL}/api/proxy/sms/messages/${record.id}`, { headers: proxyHeaders() });
        record.text = msgRes.ok ? (await msgRes.json()).data?.text : null;
      } else {
        msgRes = await fetch(`https://api.telnyx.com/v2/messages/${record.id}`, { headers: directHeaders() });
        record.text = msgRes.ok ? (await msgRes.json()).data?.text : null;
      }
    }

    console.log(`From: ${record.cli}`);
    console.log(`Date: ${record.sent_at}`);
    console.log(`Text: ${record.text ?? text ?? "(unavailable)"}`);
    console.log("");
  }
}

export default async function sms(argv) {
  const [action, ...rest] = argv;

  switch (action) {
    case "send": return send(rest);
    case "poll": return poll(rest);
    case "status": return status(rest);
    case "recent": return recent(rest);
    default:
      console.error("Usage: services.mjs sms <send|poll|status|recent> [options]");
      process.exit(1);
  }
}
