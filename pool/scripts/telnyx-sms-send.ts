/**
 * Send a single SMS via Telnyx.
 *
 * Usage:  pnpm telnyx:sms-send
 *         pnpm telnyx:sms-send "+15551234567" "Custom message"
 */

const API_KEY = process.env.TELNYX_API_KEY;
if (!API_KEY) {
  console.error("TELNYX_API_KEY not set. Add it to pool/.env");
  process.exit(1);
}

const FROM = "+12163698712";
const DEFAULT_TO = "+12082288548";

const to = process.argv[2] || DEFAULT_TO;
const text = process.argv[3] || "Hello from Convos QA!";

const res = await fetch("https://api.telnyx.com/v2/messages", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ from: FROM, to, text }),
});

const body = (await res.json()) as any;

if (!res.ok) {
  console.error(`Send failed (${res.status}):`, body?.errors ?? body);
  process.exit(1);
}

console.log(`Sent "${text}" from ${FROM} to ${to} — ID: ${body?.data?.id}`);
