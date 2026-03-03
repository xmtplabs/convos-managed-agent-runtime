import { Router } from "express";
import { config } from "./config";
import { handleRailwayWebhook } from "./webhook";
import { sendMetric } from "./metrics";

export const webhookRouter = Router();

/**
 * POST /webhooks/railway/:secret
 *
 * Railway webhook endpoint. Auth via secret in URL path (Railway doesn't
 * support HMAC signing). Responds 200 immediately, processes async.
 */
webhookRouter.post("/webhooks/railway/:secret", (req, res) => {
  const { secret } = req.params;

  if (secret !== config.poolApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const eventType = req.body?.type || "unknown";
  sendMetric("webhook.received", 1, { event: eventType });

  // Respond immediately — Railway expects fast ack
  res.status(200).json({ ok: true });

  // Process async
  handleRailwayWebhook(req.body).then(() => {
    sendMetric("webhook.processed", 1, { event: eventType });
  }).catch((err) => {
    sendMetric("webhook.error", 1, { event: eventType });
    console.error(`[webhook] Error processing ${eventType}:`, err.message);
  });
});
