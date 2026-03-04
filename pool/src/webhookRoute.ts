import { Router } from "express";
import { config } from "./config";
import { handleRailwayWebhook } from "./webhook";
import { metricCount } from "./metrics";

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
