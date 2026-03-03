#!/usr/bin/env node
/**
 * Info handler — returns what services are available.
 * Usage: node services.mjs info
 */

export default async function info() {
  const inboxId = process.env.AGENTMAIL_INBOX_ID || null;
  // AGENTMAIL_INBOX_ID is already a full email address (e.g. agent@agentmail.to)
  const email = inboxId;
  const phone = process.env.TELNYX_PHONE_NUMBER || null;

  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const ngrok = process.env.NGROK_URL;
  const port = process.env.POOL_SERVER_PORT || process.env.PORT || "18789";
  const base = domain
    ? `https://${domain}`
    : ngrok
      ? ngrok.replace(/\/$/, "")
      : `http://127.0.0.1:${port}`;
  const servicesUrl = `${base}/web-tools/services`;

  console.log(JSON.stringify({ email, phone, servicesUrl }, null, 2));
}
