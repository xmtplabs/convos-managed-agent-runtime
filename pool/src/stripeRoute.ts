import express from "express";
import { eq, and } from "drizzle-orm";
import { config } from "./config";
import { db as pgDb } from "./db/connection";
import { instanceServices, instanceInfra, payments } from "./db/schema";
import * as db from "./db/pool";
import * as openrouter from "./services/providers/openrouter";
import * as stripe from "./services/providers/stripe";
import * as issuing from "./services/providers/stripe-issuing";

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
      const purpose = pi.metadata?.purpose || "credits";

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
        // Only bump OpenRouter credits for credit purchases, not card funding
        if (purpose === "credits") {
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

          await openrouter.updateKeyLimit(hash, newLimit);

          const updatedMeta = { ...((svc.resourceMeta as any) || {}), limit: newLimit };
          await pgDb
            .update(instanceServices)
            .set({ resourceMeta: updatedMeta })
            .where(eq(instanceServices.id, svc.id));

          console.log(
            `[stripe] Webhook: increased limit for instance ${instanceId}: $${currentLimit} → $${newLimit} (PI: ${pi.id})`,
          );
        } else {
          console.log(`[stripe] Webhook: card payment ${pi.id} for instance ${instanceId} — no credit bump`);
        }

        // Mark payment as succeeded
        await pgDb
          .update(payments)
          .set({ status: "succeeded", updatedAt: new Date().toISOString() })
          .where(eq(payments.stripePaymentIntentId, pi.id));
      } catch (err: any) {
        console.error(`[stripe] Webhook: failed to process payment ${pi.id}:`, err.message);
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

/** Return the Stripe customer balance for an instance. */
stripeApiRouter.post("/api/pool/stripe/balance", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "Session expired — refresh the page" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Session expired — refresh the page and try again" });
      return;
    }

    // Look up Stripe customer
    const rows = await pgDb
      .select({ resourceId: instanceServices.resourceId })
      .from(instanceServices)
      .where(
        and(
          eq(instanceServices.instanceId, instanceId),
          eq(instanceServices.toolId, "stripe"),
        ),
      );

    if (!rows[0]) {
      res.json({ balanceCents: 0 });
      return;
    }

    const balanceCents = await stripe.getCustomerBalance(rows[0].resourceId);
    res.json({ balanceCents });
  } catch (err: any) {
    console.error("[stripe] Balance endpoint failed:", err);
    res.status(500).json({ error: "Could not load balance — try again" });
  }
});

/** Redeem a coupon code — bumps OpenRouter limit by $20. */
stripeApiRouter.post("/api/pool/stripe/redeem-coupon", async (req, res) => {
  try {
    const { instanceId, gatewayToken, code } = req.body || {};
    if (!instanceId || !gatewayToken || !code) {
      res.status(400).json({ error: "Please enter a coupon code" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Session expired — refresh the page and try again" });
      return;
    }

    const validCode = process.env.COUPON_CODE;
    if (!validCode || code.trim().toUpperCase() !== validCode.trim().toUpperCase()) {
      res.status(400).json({ error: "Invalid coupon code" });
      return;
    }

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
      res.status(404).json({ error: "Agent not set up yet — try again in a moment" });
      return;
    }

    const hash = svc.resourceId;
    const currentLimit = (svc.resourceMeta as any)?.limit ?? config.openrouterKeyLimit;
    const couponMax = parseInt(process.env.COUPON_MAX_LIMIT || "100", 10);
    if (currentLimit >= couponMax) {
      res.status(409).json({ error: `Max with coupon is $${couponMax}` });
      return;
    }
    const increment = 20;
    const newLimit = Math.min(currentLimit + increment, couponMax);

    await openrouter.updateKeyLimit(hash, newLimit);

    const updatedMeta = { ...((svc.resourceMeta as any) || {}), limit: newLimit };
    await pgDb
      .update(instanceServices)
      .set({ resourceMeta: updatedMeta })
      .where(eq(instanceServices.id, svc.id));

    console.log(`[stripe] Coupon redeemed for instance ${instanceId}: $${currentLimit} → $${newLimit}`);
    res.json({ ok: true, previousLimit: currentLimit, newLimit });
  } catch (err: any) {
    console.error("[stripe] Coupon redemption failed:", err);
    res.status(500).json({ error: "Something went wrong — try again" });
  }
});

/** Return Stripe publishable key (not a secret). */
stripeApiRouter.post("/api/pool/stripe/config", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "Session expired — refresh the page" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Session expired — refresh the page and try again" });
      return;
    }

    if (!config.stripePublishableKey) {
      res.status(503).json({ error: "Payments are not available right now" });
      return;
    }

    res.json({ publishableKey: config.stripePublishableKey });
  } catch (err: any) {
    console.error("[stripe] Config endpoint failed:", err);
    res.status(500).json({ error: "Something went wrong — try again" });
  }
});

/** Request a spending card: charge user, then issue a virtual card via Stripe Issuing. */
stripeApiRouter.post("/api/pool/stripe/request-card", async (req, res) => {
  try {
    const { instanceId, gatewayToken, amountCents } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "Session expired — refresh the page" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Session expired — refresh the page and try again" });
      return;
    }

    if (!config.stripeSecretKey) {
      res.status(503).json({ error: "Card issuing is not available right now" });
      return;
    }

    const cents = amountCents || issuing.DEFAULT_SPENDING_LIMIT_CENTS;
    if (typeof cents !== "number" || cents < 100) {
      res.status(400).json({ error: "Minimum card amount is $1" });
      return;
    }

    // Check if card already exists
    const existingCard = await pgDb
      .select({ resourceId: instanceServices.resourceId, resourceMeta: instanceServices.resourceMeta })
      .from(instanceServices)
      .where(
        and(
          eq(instanceServices.instanceId, instanceId),
          eq(instanceServices.toolId, "stripe-issuing"),
        ),
      );

    if (existingCard[0]) {
      // Card exists — increase spending limit
      const meta = existingCard[0].resourceMeta as any;
      const currentLimit = meta?.spendingLimitCents || 0;
      const newLimit = currentLimit + cents;
      await issuing.updateSpendingLimit(existingCard[0].resourceId, newLimit);
      await pgDb
        .update(instanceServices)
        .set({ resourceMeta: { ...meta, spendingLimitCents: newLimit } })
        .where(
          and(
            eq(instanceServices.instanceId, instanceId),
            eq(instanceServices.toolId, "stripe-issuing"),
          ),
        );
      console.log(`[stripe] Card top-up for instance ${instanceId}: $${(currentLimit / 100).toFixed(2)} → $${(newLimit / 100).toFixed(2)}`);
      res.json({ ok: true, action: "topup", newLimitCents: newLimit, last4: meta?.last4 });
      return;
    }

    // Issue new card — enrich with instance metadata for Stripe dashboard
    const instance = await db.findById(instanceId);
    const infraRows = await pgDb
      .select({ providerProjectId: instanceInfra.providerProjectId })
      .from(instanceInfra)
      .where(eq(instanceInfra.instanceId, instanceId));
    const card = await issuing.issueCard(instanceId, cents, {
      agentName: instance?.agentName || instance?.name || instanceId,
      instanceUrl: instance?.url || "",
      railwayProjectId: infraRows[0]?.providerProjectId || "",
    });
    await pgDb.insert(instanceServices).values({
      instanceId,
      toolId: "stripe-issuing",
      resourceId: card.cardId,
      envKey: "STRIPE_CARD_ID",
      resourceMeta: {
        cardholderId: card.cardholderId,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear,
        brand: card.brand,
        spendingLimitCents: cents,
      },
    });

    console.log(`[stripe] Issued card ****${card.last4} for instance ${instanceId}, limit=$${(cents / 100).toFixed(2)}`);
    res.json({ ok: true, action: "issued", last4: card.last4, brand: card.brand, spendingLimitCents: cents });
  } catch (err: any) {
    console.error("[stripe] Request card failed:", err);
    res.status(500).json({ error: "Failed to issue card — try again" });
  }
});

/** Return card info (masked) for display on services page. */
stripeApiRouter.post("/api/pool/stripe/card-info", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "Session expired — refresh the page" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Session expired — refresh the page and try again" });
      return;
    }

    const rows = await pgDb
      .select({ resourceId: instanceServices.resourceId, resourceMeta: instanceServices.resourceMeta })
      .from(instanceServices)
      .where(
        and(
          eq(instanceServices.instanceId, instanceId),
          eq(instanceServices.toolId, "stripe-issuing"),
        ),
      );

    if (!rows[0]) {
      res.json({ hasCard: false });
      return;
    }

    const meta = rows[0].resourceMeta as any;

    // Get current spending
    let spentCents = 0;
    try {
      const spending = await issuing.getCardSpending(meta.cardholderId);
      spentCents = spending.totalSpentCents;
    } catch { /* ignore */ }

    res.json({
      hasCard: true,
      last4: meta.last4,
      brand: meta.brand,
      expMonth: meta.expMonth,
      expYear: meta.expYear,
      spendingLimitCents: meta.spendingLimitCents || 0,
      spentCents,
    });
  } catch (err: any) {
    console.error("[stripe] Card info failed:", err);
    res.status(500).json({ error: "Could not load card info — try again" });
  }
});

/** Return full card details (number, CVC) — for agent use only, authenticated by gateway token. */
stripeApiRouter.post("/api/pool/stripe/card-details", async (req, res) => {
  try {
    const { instanceId, gatewayToken } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "Session expired — refresh the page" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Session expired — refresh the page and try again" });
      return;
    }

    const rows = await pgDb
      .select({ resourceId: instanceServices.resourceId, resourceMeta: instanceServices.resourceMeta })
      .from(instanceServices)
      .where(
        and(
          eq(instanceServices.instanceId, instanceId),
          eq(instanceServices.toolId, "stripe-issuing"),
        ),
      );

    if (!rows[0]) {
      res.json({ hasCard: false });
      return;
    }

    const details = await issuing.getCardDetails(rows[0].resourceId);
    const meta = rows[0].resourceMeta as any;

    res.json({
      hasCard: true,
      number: details.number,
      cvc: details.cvc,
      expMonth: details.expMonth,
      expYear: details.expYear,
      brand: meta.brand,
      spendingLimitCents: meta.spendingLimitCents || 0,
    });
  } catch (err: any) {
    console.error("[stripe] Card details failed:", err);
    res.status(500).json({ error: "Could not load card details — try again" });
  }
});

/** Create a PaymentIntent for a credit package. */
stripeApiRouter.post("/api/pool/stripe/create-payment-intent", async (req, res) => {
  try {
    const { instanceId, gatewayToken, amountCents, purpose } = req.body || {};
    if (!instanceId || !gatewayToken) {
      res.status(400).json({ error: "Session expired — refresh the page" });
      return;
    }
    const valid = await db.findInstanceByToken(instanceId, gatewayToken);
    if (!valid) {
      res.status(403).json({ error: "Session expired — refresh the page and try again" });
      return;
    }

    if (!config.stripeSecretKey) {
      res.status(503).json({ error: "Payments are not available right now" });
      return;
    }

    // Validate amount
    if (!amountCents || typeof amountCents !== "number" || amountCents < stripe.MIN_TOPUP_CENTS) {
      res.status(400).json({
        error: `Minimum top-up is $${(stripe.MIN_TOPUP_CENTS / 100).toFixed(2)}`,
      });
      return;
    }

    const paymentPurpose: "credits" | "card" = purpose === "card" ? "card" : "credits";

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
      const infraRows = await pgDb
        .select({ providerProjectId: instanceInfra.providerProjectId })
        .from(instanceInfra)
        .where(eq(instanceInfra.instanceId, instanceId));
      const agentName = instance?.agentName || instance?.name || instanceId;
      const instanceUrl = instance?.url || "";
      const projectId = infraRows[0]?.providerProjectId || "";
      customerId = await stripe.createCustomer(instanceId, {
        agentName,
        instanceUrl,
        railwayProjectId: projectId,
      });
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
      paymentPurpose,
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
    res.status(500).json({ error: "Payment failed — try again" });
  }
});
