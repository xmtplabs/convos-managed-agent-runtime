#!/usr/bin/env node
/**
 * Get the status of a sent SMS message.
 * Usage: node scripts/get-message.mjs <message_id>
 * Env: TELNYX_API_KEY (required)
 */

const API_KEY = process.env.TELNYX_API_KEY;
if (!API_KEY) { console.error("TELNYX_API_KEY is required"); process.exit(1); }

const messageId = process.argv[2];
if (!messageId) {
  console.error("Usage: node get-message.mjs <message_id>");
  process.exit(1);
}

const res = await fetch(`https://api.telnyx.com/v2/messages/${messageId}`, {
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
});

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
