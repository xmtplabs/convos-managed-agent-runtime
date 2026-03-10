import express from "express";
import { eq, and } from "drizzle-orm";
import { config } from "./config";
import { db as pgDb } from "./db/connection";
import { instanceServices } from "./db/schema";
import * as db from "./db/pool";
import * as openrouter from "./services/providers/openrouter";

export const couponRouter = express.Router();

/** Redeem a coupon code — bumps OpenRouter limit by $20. */
couponRouter.post("/api/pool/redeem-coupon", async (req, res) => {
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

    console.log(`[coupon] Coupon redeemed for instance ${instanceId}: $${currentLimit} → $${newLimit}`);
    res.json({ ok: true, previousLimit: currentLimit, newLimit });
  } catch (err: any) {
    console.error("[coupon] Coupon redemption failed:", err);
    res.status(500).json({ error: "Something went wrong — try again" });
  }
});
