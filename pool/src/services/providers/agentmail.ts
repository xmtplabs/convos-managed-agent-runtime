import { config } from "../../config";

/** Create a per-instance AgentMail inbox. Retries up to 3 times on transient errors. */
export async function createInbox(instanceId: string): Promise<string> {
  const apiKey = config.agentmailApiKey;
  if (!apiKey) throw new Error("AGENTMAIL_API_KEY not set");

  const envPrefix = config.poolEnvironment === "production" ? "" : `${config.poolEnvironment}-`;
  const username = `assistant-${envPrefix}${instanceId}`;
  const clientId = `assistant-${envPrefix}${instanceId}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.agentmail.to/v0/inboxes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        domain: config.agentmailDomain || undefined,
        display_name: config.defaultAgentName,
        client_id: clientId,
      }),
    });
    const body = await res.json() as any;
    const inboxId = body?.inbox_id;
    if (inboxId) {
      console.log(`[agentmail] Created inbox ${inboxId} for ${clientId}`);
      return inboxId;
    }

    const isRetryable = res.status >= 500 || res.status === 429;
    if (isRetryable && attempt < 3) {
      console.warn(`[agentmail] Create inbox attempt ${attempt}/3 failed (${res.status}), retrying in ${attempt * 2}s...`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }

    console.error(`[agentmail] Create inbox failed after ${attempt} attempt(s): ${res.status}`, body);
    throw new Error(`AgentMail inbox creation failed: ${res.status}`);
  }

  throw new Error("AgentMail inbox creation failed: max retries exceeded");
}

/** List all inboxes. Returns count and items. */
export async function listInboxes(): Promise<{ count: number }> {
  const apiKey = config.agentmailApiKey;
  if (!apiKey) return { count: 0 };

  try {
    const res = await fetch("https://api.agentmail.to/v0/inboxes", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = await res.json() as any;
    const inboxes = body?.inboxes || body?.data || [];
    return { count: Array.isArray(inboxes) ? inboxes.length : 0 };
  } catch (err: any) {
    console.warn("[agentmail] List inboxes failed:", err.message);
    return { count: 0 };
  }
}

/**
 * Ensure an AgentMail webhook is registered for this pool.
 * Idempotent via client_id — AgentMail deduplicates.
 * Called once at pool startup.
 */
export async function ensureWebhook(): Promise<void> {
  const apiKey = config.agentmailApiKey;
  const poolUrl = config.poolUrl;
  if (!apiKey) {
    console.warn("[agentmail] No API key — skipping webhook registration");
    return;
  }
  if (!poolUrl) {
    console.warn("[agentmail] No POOL_URL — skipping webhook registration");
    return;
  }

  const webhookUrl = `${poolUrl}/webhooks/agentmail`;
  const clientId = `convos-pool-${config.poolEnvironment}`;

  try {
    const res = await fetch("https://api.agentmail.to/v0/webhooks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: webhookUrl,
        event_types: ["message.received"],
        client_id: clientId,
      }),
    });
    const body = await res.json() as any;
    if (res.ok || res.status === 409) {
      const secret = body?.secret;
      console.log(`[agentmail] Webhook registered: ${webhookUrl} (id=${body?.id || body?.webhook_id || "existing"})`);
      if (secret && !config.agentmailWebhookSecret) {
        console.log(`[agentmail] ⚠️  Set AGENTMAIL_WEBHOOK_SECRET=${secret} in your env`);
      }
    } else {
      console.warn(`[agentmail] Webhook registration failed: ${res.status}`, body);
    }
  } catch (err: any) {
    console.warn("[agentmail] Webhook registration error:", err.message);
  }
}

/** Delete an AgentMail inbox. Best-effort — logs and swallows errors. */
export async function deleteInbox(inboxId: string): Promise<boolean> {
  const apiKey = config.agentmailApiKey;
  if (!apiKey || !inboxId) return false;

  try {
    const res = await fetch(`https://api.agentmail.to/v0/inboxes/${inboxId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      console.log(`[agentmail] Deleted inbox ${inboxId}`);
      return true;
    }
    const body = await res.text();
    console.warn(`[agentmail] Failed to delete inbox ${inboxId}: ${res.status} ${body}`);
    return false;
  } catch (err: any) {
    console.warn(`[agentmail] Failed to delete inbox ${inboxId}:`, err.message);
    return false;
  }
}
