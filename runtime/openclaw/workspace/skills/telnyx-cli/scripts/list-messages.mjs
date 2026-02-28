#!/usr/bin/env node
/**
 * List recent inbound SMS messages with text content.
 * Usage: node scripts/list-messages.mjs [--limit N]
 * Env: TELNYX_API_KEY, TELNYX_PHONE_NUMBER (required)
 */

const API_KEY = process.env.TELNYX_API_KEY;
const PHONE = process.env.TELNYX_PHONE_NUMBER;
if (!API_KEY) { console.error("TELNYX_API_KEY is required"); process.exit(1); }
if (!PHONE) { console.error("TELNYX_PHONE_NUMBER is required"); process.exit(1); }

const args = process.argv.slice(2);
let limit = 10;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--limit") limit = parseInt(args[++i], 10) || 10;
}

const hdrs = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

// 1. Get inbound MDR records
const params = new URLSearchParams({
  "filter[record_type]": "message",
  "filter[direction]": "inbound",
  "filter[cld]": PHONE,
  "page[size]": String(limit),
});

const res = await fetch(`https://api.telnyx.com/v2/detail_records?${params}`, { headers: hdrs });
const body = await res.json();

if (!res.ok) {
  const err = body?.errors?.[0];
  console.error(`Failed (${res.status}): ${err?.detail || err?.title || JSON.stringify(body)}`);
  process.exit(1);
}

const records = body.data || [];
console.log(`Inbound messages for ${PHONE}: ${records.length} result(s)\n`);

// 2. Fetch text for each message
for (const r of records) {
  const msgRes = await fetch(`https://api.telnyx.com/v2/messages/${r.id}`, { headers: hdrs });
  const text = msgRes.ok ? (await msgRes.json()).data?.text : null;

  console.log(`  From: ${r.cli}`);
  console.log(`  Date: ${r.sent_at}`);
  console.log(`  Text: ${text ?? "(unavailable)"}`);
  console.log("");
}
