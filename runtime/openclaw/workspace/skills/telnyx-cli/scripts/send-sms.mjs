#!/usr/bin/env node
/**
 * Send an SMS via Telnyx REST API.
 * Usage: node scripts/send-sms.mjs --to +15559876543 --text "Hello!"
 * Env: TELNYX_API_KEY (required), TELNYX_PHONE_NUMBER (required, used as --from)
 */

const API_KEY = process.env.TELNYX_API_KEY;
const FROM = process.env.TELNYX_PHONE_NUMBER;

if (!API_KEY) { console.error("TELNYX_API_KEY is required"); process.exit(1); }
if (!FROM) { console.error("TELNYX_PHONE_NUMBER is required"); process.exit(1); }

const args = process.argv.slice(2);
let to, text;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--to") to = args[++i];
  else if (args[i] === "--text") text = args[++i];
}

if (!to || text === undefined) {
  console.error("Usage: node send-sms.mjs --to <phone> --text <message>");
  process.exit(1);
}

if (!to.startsWith("+1")) {
  console.error("Only US numbers (+1) are supported.");
  process.exit(1);
}

const res = await fetch("https://api.telnyx.com/v2/messages", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ from: FROM, to, text }),
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
console.log(`  From: ${msg.from?.phone_number || FROM}`);
console.log(`  Status: ${msg.to?.[0]?.status || msg.status || "queued"}`);
