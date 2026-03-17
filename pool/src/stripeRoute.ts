import { Router, raw } from "express";
import { config } from "./config";
import * as stripeProvider from "./services/providers/stripe";

export const stripeRouter = Router();

/**
 * POST /webhooks/stripe
 *
 * Stripe webhook endpoint. Uses raw body for signature verification.
 * Currently logs events only — no money movement until billing is enabled.
 */
stripeRouter.post(
  "/webhooks/stripe",
  raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event;
    try {
      event = stripeProvider.constructWebhookEvent(req.body as Buffer, sig);
    } catch (err: any) {
      console.error("[stripe] Webhook signature verification failed:", err.message);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    console.log(`[stripe] Received event: ${event.type} (${event.id})`);

    // Stub handlers — log and acknowledge. Actual processing comes later.
    switch (event.type) {
      case "payment_intent.succeeded":
        console.log(`[stripe] Payment intent succeeded: ${(event.data.object as any).id}`);
        break;
      case "payment_intent.payment_failed":
        console.log(`[stripe] Payment intent failed: ${(event.data.object as any).id}`);
        break;
      case "customer.created":
        console.log(`[stripe] Customer created: ${(event.data.object as any).id}`);
        break;
      case "customer.subscription.created":
        console.log(`[stripe] Subscription created: ${(event.data.object as any).id}`);
        break;
      case "customer.subscription.updated":
        console.log(`[stripe] Subscription updated: ${(event.data.object as any).id}`);
        break;
      case "customer.subscription.deleted":
        console.log(`[stripe] Subscription deleted: ${(event.data.object as any).id}`);
        break;
      default:
        console.log(`[stripe] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  },
);

/**
 * POST /api/pool/stripe/config
 *
 * Returns the publishable key so the frontend can initialize Stripe Elements.
 * Instance-authenticated (instanceId + gatewayToken).
 * Returns empty if Stripe is not configured (graceful degradation).
 */
stripeRouter.post("/api/pool/stripe/config", async (req, res) => {
  const { instanceId, gatewayToken } = req.body || {};
  if (!instanceId || !gatewayToken) {
    res.status(400).json({ error: "Missing credentials" });
    return;
  }

  // Import lazily to avoid circular deps
  const db = await import("./db/pool");
  const valid = await db.findInstanceByToken(instanceId, gatewayToken);
  if (!valid) {
    res.status(403).json({ error: "Invalid credentials" });
    return;
  }

  const publishableKey = config.stripePublishableKey;
  res.json({
    configured: !!publishableKey,
    publishableKey: publishableKey || null,
  });
});
