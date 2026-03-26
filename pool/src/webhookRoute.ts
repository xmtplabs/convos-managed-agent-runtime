import { Router, raw } from "express";
import { verify } from "node:crypto";
import { Webhook } from "svix";
import { config } from "./config";
import { handleRailwayWebhook } from "./webhook";
import { metricCount } from "./metrics";
import * as db from "./db/pool";
import { maybeAutoReplySms, maybeAutoReplyEmail } from "./autoReply";

/**
 * Ed25519 SPKI DER prefix — fixed 12-byte header for wrapping a raw 32-byte
 * Ed25519 public key into the SubjectPublicKeyInfo format Node's crypto expects.
 */
const ED25519_SPKI_PREFIX = Buffer.from(
  "302a300506032b6570032100",
  "hex",
);

/** Verify a Telnyx webhook signature (Ed25519). Throws on failure. */
function verifyTelnyxSignature(
  rawBody: Buffer,
  signatureHeader: string,
  timestampHeader: string,
  publicKeyBase64: string,
  toleranceSec = 300,
): void {
  // Replay protection
  const ts = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  if (Number.isNaN(ts) || Math.abs(now - ts) > toleranceSec) {
    throw new Error("Timestamp outside tolerance window");
  }

  const payload = Buffer.concat([Buffer.from(`${timestampHeader}|`), rawBody]);
  const signature = Buffer.from(signatureHeader, "base64");
  const rawKey = Buffer.from(publicKeyBase64, "base64");
  const spkiKey = Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);

  const valid = verify(null, payload, { key: spkiKey, format: "der", type: "spki" }, signature);
  if (!valid) throw new Error("Invalid signature");
}

export const webhookRouter = Router();

/**
 * POST /webhooks/railway/:secret
 *
 * Railway webhook endpoint. Auth via secret in URL path (Railway doesn't
 * support HMAC signing). Responds 200 immediately, processes async.
 */
webhookRouter.post("/webhooks/railway/:secret", async (req, res) => {
  const { secret } = req.params;

  if (secret !== config.poolApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const eventType = req.body?.type || "unknown";
  metricCount("webhook.received", 1, { event: eventType });

  // Process event synchronously (DB lookups + status updates are fast).
  // Health check retries are fire-and-forget inside the handler.
  // If the fast path fails (e.g. DB down), respond 500 so Railway retries.
  try {
    const matched = await handleRailwayWebhook(req.body);
    if (matched) metricCount("webhook.processed", 1, { event: eventType });
    res.status(200).json({ ok: true });
  } catch (err: any) {
    metricCount("webhook.error", 1, { event: eventType });
    console.error(`[webhook] Error processing ${eventType}:`, err.message);
    res.status(500).json({ error: "Processing failed" });
  }
});

/**
 * POST /webhooks/agentmail
 *
 * AgentMail webhook endpoint. Receives email events (message.received, etc.)
 * and forwards notifications to the instance that owns the inbox.
 * Auth: Svix signature verification using AGENTMAIL_WEBHOOK_SECRET.
 */
webhookRouter.post(
  "/webhooks/agentmail",
  raw({ type: "application/json" }),
  async (req, res) => {
    const secret = config.agentmailWebhookSecret;
    if (!secret) {
      console.warn("[agentmail-webhook] AGENTMAIL_WEBHOOK_SECRET not set, rejecting");
      res.status(500).json({ error: "Webhook not configured" });
      return;
    }

    // Verify Svix signature
    const svixId = req.headers["svix-id"] as string | undefined;
    const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
    const svixSignature = req.headers["svix-signature"] as string | undefined;
    if (!svixId || !svixTimestamp || !svixSignature) {
      res.status(400).json({ error: "Missing svix headers" });
      return;
    }

    let payload: any;
    try {
      const wh = new Webhook(secret);
      payload = wh.verify(req.body as Buffer, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch (err: any) {
      console.error("[agentmail-webhook] Signature verification failed:", err.message);
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const eventType = payload?.event_type || "unknown";
    metricCount("agentmail_webhook.received", 1, { event: eventType });

    // Only process message.received for now
    if (eventType !== "message.received") {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    // Extract inbox and message details
    const message = payload?.message || {};
    const inboxId = message.inbox_id;
    if (!inboxId) {
      console.warn("[agentmail-webhook] No inbox_id in payload");
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    // Look up which instance owns this inbox
    const instance = await db.findInstanceByInboxId(inboxId);
    if (!instance || !instance.url || !instance.gatewayToken) {
      console.warn(`[agentmail-webhook] No instance found for inbox ${inboxId}`);
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    // Auto-reply for protected test instance (fire-and-forget, doesn't affect normal flow)
    maybeAutoReplyEmail({ inboxId, from: message.from, subject: message.subject });

    // Format notification (same format as poll.sh)
    const from = message.from || "unknown";
    const subject = message.subject || "(none)";
    const messageId = message.message_id || "";
    let text = `[System: new email] From: ${from} | Subject: ${subject}`;
    if (messageId) text += ` | ID: ${messageId}`;

    // Fire-and-forget: forward to instance via /convos/notify
    fetch(`${instance.url}/convos/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${instance.gatewayToken}`,
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      console.error(`[agentmail-webhook] Failed to notify instance ${instance.instanceId}:`, err.message);
    });

    metricCount("agentmail_webhook.forwarded", 1);
    console.log(`[agentmail-webhook] Forwarded email from ${from} to instance ${instance.instanceId}`);
    res.status(200).json({ ok: true });
  },
);

/**
 * POST /webhooks/telnyx
 *
 * Telnyx webhook endpoint. Receives inbound SMS events and forwards
 * notifications to the instance that owns the phone number.
 * Auth: Ed25519 signature verification (telnyx-signature-ed25519 header).
 */
webhookRouter.post("/webhooks/telnyx", raw({ type: "application/json" }), async (req, res) => {
  const publicKey = config.telnyxWebhookPublicKey;
  if (!publicKey) {
    console.warn("[telnyx-webhook] TELNYX_WEBHOOK_PUBLIC_KEY not set, rejecting");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  const signature = req.headers["telnyx-signature-ed25519"] as string | undefined;
  const timestamp = req.headers["telnyx-timestamp"] as string | undefined;
  if (!signature || !timestamp) {
    res.status(400).json({ error: "Missing telnyx signature headers" });
    return;
  }

  try {
    verifyTelnyxSignature(req.body as Buffer, signature, timestamp, publicKey);
  } catch (err: any) {
    console.error("[telnyx-webhook] Signature verification failed:", err.message);
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = JSON.parse((req.body as Buffer).toString());
  const eventType = payload?.data?.event_type || "unknown";
  console.log(`[telnyx-webhook] Received event: ${eventType}`);
  metricCount("telnyx_webhook.received", 1, { event: eventType });

  // Only process inbound messages
  if (eventType !== "message.received" && eventType !== "message.finalized") {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const msg = payload?.data?.payload || {};

  // Skip outbound (agent's own sends) — only notify on inbound
  if (msg.direction === "outbound") {
    console.log(`[telnyx-webhook] Ignoring outbound message`);
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const to = msg.to?.[0]?.phone_number || msg.to;
  const from = msg.from?.phone_number || msg.from || "unknown";
  const text = msg.text || "";

  // Auto-reply for protected test instance (fire-and-forget, doesn't affect normal flow)
  maybeAutoReplySms({ to, from });

  if (!to) {
    console.warn("[telnyx-webhook] No destination phone in payload");
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  // Look up which instance owns this phone number
  const instance = await db.findInstanceByPhone(to);
  if (!instance || !instance.url || !instance.gatewayToken) {
    console.warn(`[telnyx-webhook] No instance found for phone ${to}`);
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  // Format notification (same format as poll.sh)
  const notification = `You got a new text. "${text.slice(0, 80) || "(empty)"}" from ${from}`;

  // Fire-and-forget: forward to instance via /convos/notify
  fetch(`${instance.url}/convos/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${instance.gatewayToken}`,
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ text: notification }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    console.error(`[telnyx-webhook] Failed to notify instance ${instance.instanceId}:`, err.message);
  });

  metricCount("telnyx_webhook.forwarded", 1);
  console.log(`[telnyx-webhook] Forwarded SMS from ${from} to instance ${instance.instanceId}`);
  res.status(200).json({ ok: true });
});
