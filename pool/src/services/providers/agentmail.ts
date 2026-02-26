import { config } from "../../config";

/** Create a per-instance AgentMail inbox. Retries up to 3 times on transient errors. */
export async function createInbox(instanceId: string): Promise<string> {
  const apiKey = config.agentmailApiKey;
  if (!apiKey) throw new Error("AGENTMAIL_API_KEY not set");

  const username = `convos-agent-${instanceId}`;
  const clientId = `convos-agent-${instanceId}`;

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
        display_name: "Convos Agent",
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
