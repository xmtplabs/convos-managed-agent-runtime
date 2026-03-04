import express from "express";
import { eq, and } from "drizzle-orm";
import { config } from "./config";
import { db as pgDb } from "./db/connection";
import { instanceServices, payments } from "./db/schema";
import * as db from "./db/pool";
import * as openrouter from "./services/providers/openrouter";
import * as stripe from "./services/providers/stripe";

// ── Webhook router (must be mounted BEFORE express.json()) ──────────────────

export const stripeWebhookRouter = express.Router();

stripeWebhookRouter.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event;
    try {
      event = stripe.constructWebhookEvent(req.body as Buffer, sig);
    } catch (err: any) {
      console.error("[stripe] Webhook signature verification failed:", err.message);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as any;
      const instanceId = pi.metadata?.instanceId;
      const amountCents = parseInt(pi.metadata?.amountCents || "0", 10);

      if (!instanceId || !amountCents) {
        console.warn("[stripe] Webhook: missing metadata on PaymentIntent", pi.id);
        res.json({ received: true });
        return;
      }

      // Idempotency: skip if already processed
      const existing = await pgDb
        .select({ id: payments.id, status: payments.status })
        .from(payments)
        .where(eq(payments.stripePaymentIntentId, pi.id));

      if (existing[0]?.status === "succeeded") {
        console.log(`[stripe] Webhook: PaymentIntent ${pi.id} already processed, skipping`);
        res.json({ received: true });
        return;
      }

      try {
        // Find the instance's OpenRouter key
        const svcRows = await pgDb
          .select({
            id: instanceServices.id,
            resourceId: instanceServices.resourceId,
            resourceMeta: instanceServices.resourceMeta,
          })
          .from(instanceServices)
          .where(
            and(
              eq(instanceServices.instanceId, instanceId),
              eq(instanceServices.toolId, "openrouter"),
            ),
          );
        const svc = svcRows[0];
        if (!svc) {
          console.error(`[stripe] Webhook: no OpenRouter key for instance ${instanceId}`);
          res.status(500).json({ error: "No OpenRouter key found" });
          return;
        }

        const hash = svc.resourceId;
        const currentLimit = (svc.resourceMeta as any)?.limit ?? config.openrouterKeyLimit;
        const amountDollars = amountCents / 100;
        const newLimit = currentLimit + amountDollars;

        // Increase the OpenRouter key limit
        await openrouter.updateKeyLimit(hash, newLimit);

        // Update resourceMeta.limit in DB
        const updatedMeta = { ...((svc.resourceMeta as any) || {}), limit: newLimit };
        await pgDb
          .update(instanceServices)
          .set({ resourceMeta: updatedMeta })
          .where(eq(instanceServices.id, svc.id));

        // Mark payment as succeeded
        await pgDb
          .update(payments)
          .set({ status: "succeeded", updatedAt: new Date().toISOString() })
          .where(eq(payments.stripePaymentIntentId, pi.id));

        console.log(
          `[stripe] Webhook: increased limit for instance ${instanceId}: $${currentLimit} → $${newLimit} (PI: ${pi.id})`,
        );
      } catch (err: any) {
        console.error(`[stripe] Webhook: failed to process payment ${pi.id}:`, err.message);
        // Mark payment as failed
        await pgDb
          .update(payments)
          .set({ status: "failed", updatedAt: new Date().toISOString() })
          .where(eq(payments.stripePaymentIntentId, pi.id))
          .catch(() => {});
        res.status(500).json({ error: "Failed to process payment" });
        return;
      }
    }

    res.json({ received: true });
  },
);

// ── API router (instance-authenticated) ─────────────────────────────────────

export const stripeApiRouter = express.Router();

/** Return Stripe publishable key (not a secret). */
stripeApiRouter.post("/api/pool/stripe/config", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "instanceId and gatewayToken are required" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" });
      return;
    }

    if (!config.stripePublishableKey) {
      res.status(503).json({ error: "Stripe not configured" });
      return;
    }

    res.json({ publishableKey: config.stripePublishableKey });
  } catch (err: any) {
    console.error("[stripe] Config endpoint failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Create a PaymentIntent for a credit package. */
stripeApiRouter.post("/api/pool/stripe/create-payment-intent", async (req, res) => {
  try {
    const { instanceId, gatewayToken, amountCents } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "instanceId and gatewayToken are required" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Invalid instance ID or token" });
      return;
    }

    if (!config.stripeSecretKey) {
      res.status(503).json({ error: "Stripe not configured" });
      return;
    }

    // Validate amount
    if (!stripe.CREDIT_PACKAGES_CENTS.includes(amountCents)) {
      res.status(400).json({
        error: `Invalid amount. Valid packages: ${stripe.CREDIT_PACKAGES_CENTS.map((c) => `$${c / 100}`).join(", ")}`,
      });
      return;
    }

    // Lazy-create Stripe customer (stored in instance_services with toolId "stripe")
    let customerId: string;
    const existingRows = await pgDb
      .select({ resourceId: instanceServices.resourceId })
      .from(instanceServices)
      .where(
        and(
          eq(instanceServices.instanceId, instanceId),
          eq(instanceServices.toolId, "stripe"),
        ),
      );

    if (existingRows[0]) {
      customerId = existingRows[0].resourceId;
    } else {
      const instance = await db.findById(instanceId);
      const name = instance?.agentName || instance?.name || instanceId;
      customerId = await stripe.createCustomer(instanceId, name);
      await pgDb.insert(instanceServices).values({
        instanceId,
        toolId: "stripe",
        resourceId: customerId,
        envKey: "STRIPE_CUSTOMER_ID",
      });
    }

    // Create PaymentIntent
    const { clientSecret, paymentIntentId } = await stripe.createPaymentIntent(
      customerId,
      amountCents,
      instanceId,
    );

    // Record payment in DB
    await pgDb.insert(payments).values({
      instanceId,
      stripeCustomerId: customerId,
      stripePaymentIntentId: paymentIntentId,
      amountCents,
      status: "pending",
    });

    res.json({ clientSecret });
  } catch (err: any) {
    console.error("[stripe] Create payment intent failed:", err);
    res.status(500).json({ error: err.message });
  }
});
