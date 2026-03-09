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
import { requireInstanceAuth } from "../middleware/instanceAuth";
import { config } from "../config";
import * as db from "../db/pool";

const router = Router();

// All proxy routes require instance auth
router.use("/api/proxy", requireInstanceAuth);

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
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
    res.status(502).json({ error: `Email proxy failed: ${err.message}` });
  }
});

// GET /api/proxy/email/messages — poll inbox messages
router.get("/api/proxy/email/messages", async (req, res) => {
  const { inboxId } = await getResources(req.instanceId!);
  if (!inboxId) { res.status(404).json({ error: "No inbox provisioned" }); return; }
  if (!config.agentmailApiKey) { res.status(503).json({ error: "Email service not configured" }); return; }

  try {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const upstream = await fetch(`${AGENTMAIL_API}/inboxes/${inboxId}/messages${qs ? `?${qs}` : ""}`, {
      headers: agentmailHeaders(),
    });
    const data = await upstream.text();
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
    res.status(502).json({ error: `Email proxy failed: ${err.message}` });
  }
});

// GET /api/proxy/email/threads — poll inbox threads
router.get("/api/proxy/email/threads", async (req, res) => {
  const { inboxId } = await getResources(req.instanceId!);
  if (!inboxId) { res.status(404).json({ error: "No inbox provisioned" }); return; }
  if (!config.agentmailApiKey) { res.status(503).json({ error: "Email service not configured" }); return; }

  try {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const upstream = await fetch(`${AGENTMAIL_API}/inboxes/${inboxId}/threads${qs ? `?${qs}` : ""}`, {
      headers: agentmailHeaders(),
    });
    const data = await upstream.text();
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
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
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
    res.status(502).json({ error: `SMS proxy failed: ${err.message}` });
  }
});

// GET /api/proxy/sms/records — poll inbound SMS (injects instance's phone filter)
router.get("/api/proxy/sms/records", async (req, res) => {
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
    res.status(upstream.status).type("json").send(data);
  } catch (err: any) {
    res.status(502).json({ error: `SMS proxy failed: ${err.message}` });
  }
});

// GET /api/proxy/sms/messages/:id — get message details
router.get("/api/proxy/sms/messages/:id", async (req, res) => {
  const { phoneNumber } = await getResources(req.instanceId!);
  if (!phoneNumber) { res.status(404).json({ error: "No phone number provisioned" }); return; }
  if (!config.telnyxApiKey) { res.status(503).json({ error: "SMS service not configured" }); return; }

  try {
    const upstream = await fetch(`${TELNYX_API}/messages/${req.params.id}`, {
      headers: telnyxHeaders(),
    });
    const data = await upstream.json().catch(() => null);
    // Verify message belongs to this instance's phone number
    const msgPhone = data?.data?.from?.phone_number || data?.data?.to?.[0]?.phone_number;
    if (msgPhone && msgPhone !== phoneNumber && data?.data?.from?.phone_number !== phoneNumber) {
      res.status(403).json({ error: "Message does not belong to this instance" });
      return;
    }
    res.status(upstream.status).type("json").json(data);
  } catch (err: any) {
    res.status(502).json({ error: `SMS proxy failed: ${err.message}` });
  }
});

export { router as serviceProxyRouter };
