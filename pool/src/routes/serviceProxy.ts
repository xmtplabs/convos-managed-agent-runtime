/**
 * Service proxy — routes service API calls from instances through the pool manager.
 *
 * Instances no longer hold API keys for AgentMail or Telnyx.
 * Instead they call these proxy endpoints, authenticated with their
 * per-instance OPENCLAW_GATEWAY_TOKEN. The pool manager injects the
 * real API key and forwards to the upstream service.
 *
 * Security: email and SMS routes enforce per-instance isolation — an instance
 * can only access its own inbox/phone number (looked up from DB, not from request).
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { requireInstanceAuth } from "../middleware/instanceAuth";
import { requireAuth } from "../middleware/auth";
import { config } from "../config";
import * as db from "../db/pool";
import { instanceServices } from "../db/schema";
import { db as drizzle } from "../db/connection";
import * as agentmail from "../services/providers/agentmail";
import * as telnyx from "../services/providers/telnyx";
import { metricCount, metricHistogram } from "../metrics";

const router = Router();

/**
 * Admin-or-instance auth for provision endpoints.
 * Accepts either:
 *   - Instance auth (Bearer <instanceId>:<gatewayToken>) — instanceId from token
 *   - Admin auth (Bearer <poolApiKey>) — instanceId from request body
 */
async function requireInstanceOrAdminAuth(req: Request, res: Response, next: NextFunction) {
  // Try instance auth first
  const authHeader = req.headers.authorization || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    const token = bearerMatch[1];
    // Admin auth: token matches pool API key, instanceId from body
    if (token === config.poolApiKey) {
      const instanceId = req.body?.instanceId;
      if (!instanceId) {
        res.status(400).json({ error: "instanceId required in body when using admin auth" });
        return;
      }
      req.instanceId = instanceId;
      next();
      return;
    }
  }
  // Fall through to instance auth
  return requireInstanceAuth(req, res, next);
}

// ── Service resource cache ──────────────────────────────────────────────────
// inbox/phone are static for instance lifetime — cache to avoid DB hits per request
const resourceCache = new Map<string, { data: { inboxId: string | null; phoneNumber: string | null }; ts: number }>();
const RESOURCE_CACHE_TTL = 5 * 60 * 1000;

async function getResources(instanceId: string) {
  const cached = resourceCache.get(instanceId);
  if (cached && Date.now() - cached.ts < RESOURCE_CACHE_TTL) return cached.data;
  const data = await db.getServiceResources(instanceId);
  resourceCache.set(instanceId, { data, ts: Date.now() });
  return data;
}

// ── On-demand provisioning ───────────────────────────────────────────────────
// Explicit provisioning only. Accepts instance auth OR admin auth (pool API key + instanceId in body).
// Idempotent: returns the existing resource if already provisioned.

// POST /api/proxy/email/provision — provision an AgentMail inbox for this instance
router.post("/api/proxy/email/provision", requireInstanceOrAdminAuth, async (req, res) => {
  const instanceId = req.instanceId!;
  const { inboxId: existing } = await getResources(instanceId);
  if (existing) { res.json({ email: existing, provisioned: false }); return; }
  if (!config.agentmailApiKey) { res.status(503).json({ error: "Email service not configured on pool" }); return; }

  try {
    const inboxId = await agentmail.createInbox(instanceId);
    await drizzle.insert(instanceServices).values({
      instanceId,
      toolId: "agentmail",
      resourceId: inboxId,
      envKey: "agentmail",
      envValue: inboxId,
    });
    // Bust cache so subsequent calls see the new inbox
    resourceCache.delete(instanceId);
    metricCount("proxy.email.provision");
    console.log(`[proxy/email] provisioned inbox ${inboxId} for instance=${instanceId}`);
    res.json({ email: inboxId, provisioned: true });
  } catch (err: any) {
    console.error(`[proxy/email] provision error: instance=${instanceId} err=${err.message}`);
    metricCount("proxy.email.provision_error");
    res.status(502).json({ error: `Email provisioning failed: ${err.message}` });
  }
});

// POST /api/proxy/sms/provision — provision a Telnyx phone number for this instance
router.post("/api/proxy/sms/provision", requireInstanceOrAdminAuth, async (req, res) => {
  const instanceId = req.instanceId!;
  const { phoneNumber: existing } = await getResources(instanceId);
  if (existing) { res.json({ phone: existing, provisioned: false }); return; }
  if (!config.telnyxApiKey) { res.status(503).json({ error: "SMS service not configured on pool" }); return; }

  try {
    const { phoneNumber, messagingProfileId } = await telnyx.provisionPhone(instanceId);
    await drizzle.insert(instanceServices).values({
      instanceId,
      toolId: "telnyx",
      resourceId: phoneNumber,
      envKey: "telnyx",
      envValue: phoneNumber,
      resourceMeta: { messagingProfileId },
    });
    // Bust cache so subsequent calls see the new phone
    resourceCache.delete(instanceId);
    metricCount("proxy.sms.provision");
    console.log(`[proxy/sms] provisioned phone ${phoneNumber} for instance=${instanceId}`);
    res.json({ phone: phoneNumber, provisioned: true });
  } catch (err: any) {
    console.error(`[proxy/sms] provision error: instance=${instanceId} err=${err.message}`);
    metricCount("proxy.sms.provision_error");
    res.status(502).json({ error: `SMS provisioning failed: ${err.message}` });
  }
});

// ── Service status (admin) ───────────────────────────────────────────────────
// Read-only check: does this instance have email/SMS provisioned?
// Used by the app to show UI state without triggering provisioning.

// GET /api/proxy/services/status?instanceId=<id>
router.get("/api/proxy/services/status", requireAuth, async (req, res) => {
  const instanceId = req.query.instanceId as string;
  if (!instanceId) { res.status(400).json({ error: "instanceId query param required" }); return; }

  const { inboxId, phoneNumber } = await getResources(instanceId);
  res.json({ instanceId, email: inboxId ?? null, phone: phoneNumber ?? null });
});

// All other proxy routes require instance auth
router.use("/api/proxy", requireInstanceAuth);

// ── Instance info ────────────────────────────────────────────────────────────

// GET /api/proxy/info — return instance's provisioned resources
router.get("/api/proxy/info", async (req, res) => {
  const { inboxId, phoneNumber } = await getResources(req.instanceId!);
  res.json({ instanceId: req.instanceId, email: inboxId, phone: phoneNumber });
});

// ── Email (AgentMail) ───────────────────────────────────────────────────────

const AGENTMAIL_API = "https://api.agentmail.to/v0";

function agentmailHeaders() {
  return {
    Authorization: `Bearer ${config.agentmailApiKey}`,
    "Content-Type": "application/json",
  };
}

// POST /api/proxy/email/send — send an email
router.post("/api/proxy/email/send", async (req, res) => {
  const t0 = Date.now();
  const { inboxId } = await getResources(req.instanceId!);
  if (!inboxId) { res.status(404).json({ error: "No inbox provisioned for this instance" }); return; }
  if (!config.agentmailApiKey) { res.status(503).json({ error: "Email service not configured" }); return; }

  try {
    const upstream = await fetch(`${AGENTMAIL_API}/inboxes/${inboxId}/messages/send`, {
      method: "POST",
      headers: agentmailHeaders(),
      body: JSON.stringify(req.body),
    });
    const data = await upstream.text();
    console.log(`[proxy/email] send: instance=${req.instanceId} inbox=${inboxId} status=${upstream.status}`);
    metricCount("proxy.email.send", 1, { status: String(upstream.status) });
    metricHistogram("proxy.email.duration_ms", Date.now() - t0, { action: "send" });
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
    console.error(`[proxy/email] send error: instance=${req.instanceId} err=${err.message}`);
    metricCount("proxy.email.error", 1, { action: "send" });
    res.status(502).json({ error: `Email proxy failed: ${err.message}` });
  }
});

// GET /api/proxy/email/messages/:messageId — get single message with inline attachments
router.get("/api/proxy/email/messages/:messageId", async (req, res) => {
  const t0 = Date.now();
  const { inboxId } = await getResources(req.instanceId!);
  if (!inboxId) { res.status(404).json({ error: "No inbox provisioned" }); return; }
  if (!config.agentmailApiKey) { res.status(503).json({ error: "Email service not configured" }); return; }

  try {
    const { messageId } = req.params;
    const upstream = await fetch(`${AGENTMAIL_API}/inboxes/${inboxId}/messages/${messageId}`, {
      headers: agentmailHeaders(),
    });
    if (!upstream.ok) {
      const data = await upstream.text();
      res.status(upstream.status).type("json").send(data);
      return;
    }
    const message = await upstream.json();

    // Enrich attachments with signed download URLs (no file download — just metadata)
    if (message.attachments?.length) {
      const enriched = await Promise.all(
        message.attachments.map(async (att: any) => {
          try {
            const attRes = await fetch(
              `${AGENTMAIL_API}/inboxes/${inboxId}/messages/${messageId}/attachments/${att.attachment_id}`,
              { headers: { Authorization: `Bearer ${config.agentmailApiKey}` } },
            );
            if (!attRes.ok) return att;
            const meta = await attRes.json();
            return { ...att, download_url: meta.download_url, expires_at: meta.expires_at };
          } catch {
            return att;
          }
        }),
      );
      message.attachments = enriched;
    }

    console.log(`[proxy/email] message: instance=${req.instanceId} inbox=${inboxId} messageId=${messageId} attachments=${message.attachments?.length || 0}`);
    metricCount("proxy.email.message", 1, { status: "200" });
    metricHistogram("proxy.email.duration_ms", Date.now() - t0, { action: "message" });
    res.json(message);
  } catch (err: any) {
    console.error(`[proxy/email] message error: instance=${req.instanceId} err=${err.message}`);
    metricCount("proxy.email.error", 1, { action: "message" });
    res.status(502).json({ error: `Email proxy failed: ${err.message}` });
  }
});

// PATCH /api/proxy/email/messages/:messageId — update message labels
router.patch("/api/proxy/email/messages/:messageId", async (req, res) => {
  const { inboxId } = await getResources(req.instanceId!);
  if (!inboxId) { res.status(404).json({ error: "No inbox provisioned" }); return; }
  if (!config.agentmailApiKey) { res.status(503).json({ error: "Email service not configured" }); return; }

  try {
    const { messageId } = req.params;
    const upstream = await fetch(`${AGENTMAIL_API}/inboxes/${inboxId}/messages/${messageId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${config.agentmailApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json().catch(() => null);
    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Email proxy failed: ${err.message}` });
  }
});

// GET /api/proxy/email/messages — poll inbox messages
router.get("/api/proxy/email/messages", async (req, res) => {
  const t0 = Date.now();
  const { inboxId } = await getResources(req.instanceId!);
  if (!inboxId) { res.status(404).json({ error: "No inbox provisioned" }); return; }
  if (!config.agentmailApiKey) { res.status(503).json({ error: "Email service not configured" }); return; }

  try {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const upstream = await fetch(`${AGENTMAIL_API}/inboxes/${inboxId}/messages${qs ? `?${qs}` : ""}`, {
      headers: agentmailHeaders(),
    });
    const data = await upstream.text();
    console.log(`[proxy/email] poll: instance=${req.instanceId} inbox=${inboxId} status=${upstream.status}`);
    metricCount("proxy.email.poll", 1, { status: String(upstream.status) });
    metricHistogram("proxy.email.duration_ms", Date.now() - t0, { action: "poll" });
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
    console.error(`[proxy/email] poll error: instance=${req.instanceId} err=${err.message}`);
    metricCount("proxy.email.error", 1, { action: "poll" });
    res.status(502).json({ error: `Email proxy failed: ${err.message}` });
  }
});

// GET /api/proxy/email/threads — poll inbox threads
router.get("/api/proxy/email/threads", async (req, res) => {
  const t0 = Date.now();
  const { inboxId } = await getResources(req.instanceId!);
  if (!inboxId) { res.status(404).json({ error: "No inbox provisioned" }); return; }
  if (!config.agentmailApiKey) { res.status(503).json({ error: "Email service not configured" }); return; }

  try {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const upstream = await fetch(`${AGENTMAIL_API}/inboxes/${inboxId}/threads${qs ? `?${qs}` : ""}`, {
      headers: agentmailHeaders(),
    });
    const data = await upstream.text();
    console.log(`[proxy/email] threads: instance=${req.instanceId} inbox=${inboxId} status=${upstream.status}`);
    metricCount("proxy.email.threads", 1, { status: String(upstream.status) });
    metricHistogram("proxy.email.duration_ms", Date.now() - t0, { action: "threads" });
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
    console.error(`[proxy/email] threads error: instance=${req.instanceId} err=${err.message}`);
    metricCount("proxy.email.error", 1, { action: "threads" });
    res.status(502).json({ error: `Email proxy failed: ${err.message}` });
  }
});

// ── SMS (Telnyx) ────────────────────────────────────────────────────────────

const TELNYX_API = "https://api.telnyx.com/v2";

function telnyxHeaders() {
  return {
    Authorization: `Bearer ${config.telnyxApiKey}`,
    "Content-Type": "application/json",
  };
}

// POST /api/proxy/sms/send — send SMS (injects instance's phone as `from`)
router.post("/api/proxy/sms/send", async (req, res) => {
  const t0 = Date.now();
  const { phoneNumber } = await getResources(req.instanceId!);
  if (!phoneNumber) { res.status(404).json({ error: "No phone number provisioned" }); return; }
  if (!config.telnyxApiKey) { res.status(503).json({ error: "SMS service not configured" }); return; }

  try {
    // Force `from` to instance's phone and inject messaging profile
    const body = { ...req.body, from: phoneNumber, messaging_profile_id: config.telnyxMessagingProfileId };
    const upstream = await fetch(`${TELNYX_API}/messages`, {
      method: "POST",
      headers: telnyxHeaders(),
      body: JSON.stringify(body),
    });
    const data = await upstream.text();
    console.log(`[proxy/sms] send: instance=${req.instanceId} phone=${phoneNumber} to=${req.body.to} status=${upstream.status}`);
    metricCount("proxy.sms.send", 1, { status: String(upstream.status) });
    metricHistogram("proxy.sms.duration_ms", Date.now() - t0, { action: "send" });
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
    console.error(`[proxy/sms] send error: instance=${req.instanceId} err=${err.message}`);
    metricCount("proxy.sms.error", 1, { action: "send" });
    res.status(502).json({ error: `SMS proxy failed: ${err.message}` });
  }
});

// GET /api/proxy/sms/records — poll inbound SMS (injects instance's phone filter)
router.get("/api/proxy/sms/records", async (req, res) => {
  const t0 = Date.now();
  const { phoneNumber } = await getResources(req.instanceId!);
  if (!phoneNumber) { res.status(404).json({ error: "No phone number provisioned" }); return; }
  if (!config.telnyxApiKey) { res.status(503).json({ error: "SMS service not configured" }); return; }

  try {
    const params = new URLSearchParams(req.query as Record<string, string>);
    // Force phone filter — instance can only see its own messages
    params.set("filter[cld]", phoneNumber);
    const upstream = await fetch(`${TELNYX_API}/detail_records?${params}`, {
      headers: telnyxHeaders(),
    });
    const data = await upstream.text();
    console.log(`[proxy/sms] poll: instance=${req.instanceId} phone=${phoneNumber} status=${upstream.status}`);
    metricCount("proxy.sms.poll", 1, { status: String(upstream.status) });
    metricHistogram("proxy.sms.duration_ms", Date.now() - t0, { action: "poll" });
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
    console.error(`[proxy/sms] poll error: instance=${req.instanceId} err=${err.message}`);
    metricCount("proxy.sms.error", 1, { action: "poll" });
    res.status(502).json({ error: `SMS proxy failed: ${err.message}` });
  }
});

// GET /api/proxy/sms/messages/:id — get message details
router.get("/api/proxy/sms/messages/:id", async (req, res) => {
  const t0 = Date.now();
  const { phoneNumber } = await getResources(req.instanceId!);
  if (!phoneNumber) { res.status(404).json({ error: "No phone number provisioned" }); return; }
  if (!config.telnyxApiKey) { res.status(503).json({ error: "SMS service not configured" }); return; }

  try {
    const upstream = await fetch(`${TELNYX_API}/messages/${req.params.id}`, {
      headers: telnyxHeaders(),
    });
    const data = await upstream.json().catch(() => null);
    // Verify message involves this instance's phone (either as sender or recipient)
    const fromPhone = data?.data?.from?.phone_number;
    const toPhones = (data?.data?.to || []).map((t: any) => t.phone_number);
    if (fromPhone && fromPhone !== phoneNumber && !toPhones.includes(phoneNumber)) {
      console.warn(`[proxy/sms] message ${req.params.id} denied: instance=${req.instanceId} phone=${phoneNumber}`);
      metricCount("proxy.sms.denied", 1);
      res.status(403).json({ error: "Message does not belong to this instance" });
      return;
    }
    console.log(`[proxy/sms] message: instance=${req.instanceId} id=${req.params.id} status=${upstream.status}`);
    metricCount("proxy.sms.message", 1, { status: String(upstream.status) });
    metricHistogram("proxy.sms.duration_ms", Date.now() - t0, { action: "message" });
    res.status(upstream.status).type("json").json(data);
  } catch (err: any) {
    console.error(`[proxy/sms] message error: instance=${req.instanceId} err=${err.message}`);
    metricCount("proxy.sms.error", 1, { action: "message" });
    res.status(502).json({ error: `SMS proxy failed: ${err.message}` });
  }
});

export { router as serviceProxyRouter };
