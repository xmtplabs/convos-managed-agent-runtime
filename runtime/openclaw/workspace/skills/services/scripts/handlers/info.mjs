#!/usr/bin/env node
/**
 * Info handler — returns what services are available.
 *
 * In proxy mode (POOL_URL + INSTANCE_ID + GATEWAY_TOKEN), fetches
 * provisioned resources from the pool manager. Otherwise reads from
 * local env vars.
 *
 * Usage: node services.mjs info
 */

const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const useProxy = !!(POOL_URL && INSTANCE_ID && GATEWAY_TOKEN);

async function getProxyInfo() {
  const res = await fetch(`${POOL_URL}/api/proxy/info`, {
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Pool info failed (${res.status})`);
  return res.json();
}

export default async function info() {
  let email, phone;

  if (useProxy) {
    const data = await getProxyInfo();
    email = data.email || null;
    phone = data.phone || null;
  } else {
    // No proxy — email/phone unavailable in direct mode
    email = null;
    phone = null;
  }

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
