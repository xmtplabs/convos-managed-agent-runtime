#!/usr/bin/env node
/**
 * Card handler — check spending card info and details.
 * Usage:
 *   node services.mjs card             (check card status — masked)
 *   node services.mjs card details     (get full card number + CVC for payments)
 *
 * Env: INSTANCE_ID, OPENCLAW_GATEWAY_TOKEN, POOL_URL
 */

const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const POOL_URL = process.env.POOL_URL;

function requirePoolEnv() {
  if (!INSTANCE_ID || !GATEWAY_TOKEN || !POOL_URL) {
    console.error("Card service not available: this instance is not pool-managed.");
    process.exit(1);
  }
}

async function poolRequest(endpoint) {
  const url = `${POOL_URL}/api/pool/stripe/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId: INSTANCE_ID, gatewayToken: GATEWAY_TOKEN }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error || `Pool server returned ${res.status}`);
  }
  return body;
}

async function info() {
  requirePoolEnv();
  const data = await poolRequest("card-info");
  if (!data.hasCard) {
    console.log(JSON.stringify({ hasCard: false, message: "No spending card assigned. User can request one from the services page." }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    hasCard: true,
    brand: data.brand,
    last4: data.last4,
    expMonth: data.expMonth,
    expYear: data.expYear,
    spendingLimitCents: data.spendingLimitCents,
    spentCents: data.spentCents,
    remainingCents: data.spendingLimitCents - data.spentCents,
  }, null, 2));
}

async function details() {
  requirePoolEnv();
  const data = await poolRequest("card-details");
  if (!data.hasCard) {
    console.log(JSON.stringify({ hasCard: false, message: "No spending card assigned." }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    hasCard: true,
    number: data.number,
    cvc: data.cvc,
    expMonth: data.expMonth,
    expYear: data.expYear,
    brand: data.brand,
    spendingLimitCents: data.spendingLimitCents,
    billingAddress: {
      line1: "1131 4th Avenue South",
      city: "Nashville",
      state: "TN",
      postalCode: "37210",
      country: "US",
    },
  }, null, 2));
}

export default async function card(argv) {
  const [action] = argv;

  if (!action || action === "info") return info();
  if (action === "details") return details();

  console.error("Usage: services.mjs card [info|details]");
  process.exit(1);
}
