/**
 * Auto-reply for protected test instance.
 *
 * PURPOSE: End-to-end webhook testing without manual intervention.
 * The protected test instance has a fixed phone number and email inbox.
 * When either receives an inbound message, this module auto-replies with
 * the current timestamp so we can verify the full webhook → reply loop.
 *
 * HOW IT WORKS:
 * - webhookRoute.ts calls maybeAutoReplySms / maybeAutoReplyEmail on every
 *   inbound webhook.
 * - These functions check if the destination matches the hardcoded protected
 *   resources below. If not, they return immediately (no-op).
 * - If matched, they fire-and-forget a reply via the Telnyx / AgentMail API.
 * - This runs in parallel with the normal webhook flow — it does NOT block,
 *   replace, or interfere with normal instance notification forwarding.
 *
 * SAFE TO DELETE: This file is a testing utility. Removing it (and the two
 * call sites in webhookRoute.ts) restores the original behavior with zero
 * side effects.
 */

import { config } from "./config";

// ── Protected test instance resources (hardcoded) ───────────────────────────
const AUTO_REPLY_PHONE = "+12082288548";
const AUTO_REPLY_INBOX_ID = "convos-agent-ef1apq8i-0uu";
const AUTO_REPLY_EMAIL = AUTO_REPLY_INBOX_ID + "@mail.convos.org";

function timestamp(): string {
  return `Auto-reply: ${new Date().toISOString()}`;
}

// ── SMS (Telnyx) ────────────────────────────────────────────────────────────

/**
 * If the inbound SMS was sent TO the protected phone number, reply to the
 * sender with a timestamp. No-op for any other phone number.
 */
export function maybeAutoReplySms({ to, from }: { to: string; from: string }) {
  console.log(`[auto-reply] SMS check: to=${to} from=${from} match=${to === AUTO_REPLY_PHONE}`);
  if (to !== AUTO_REPLY_PHONE) return;
  if (from === AUTO_REPLY_PHONE) return; // prevent self-reply loop
  if (!config.telnyxApiKey) {
    console.log("[auto-reply] SMS skipped: no telnyxApiKey");
    return;
  }

  fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.telnyxApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: AUTO_REPLY_PHONE,
      to: from,
      text: timestamp(),
      messaging_profile_id: config.telnyxMessagingProfileId,
    }),
    signal: AbortSignal.timeout(15_000),
  })
    .then(() => console.log(`[auto-reply] SMS → ${from}`))
    .catch((err) => console.error(`[auto-reply] SMS failed: ${err.message}`));
}

// ── Email (AgentMail) ───────────────────────────────────────────────────────

/**
 * If the inbound email was sent TO the protected inbox, reply to the sender
 * with a timestamp. No-op for any other inbox.
 */
export function maybeAutoReplyEmail({
  inboxId,
  from,
  subject,
}: {
  inboxId: string;
  from: string;
  subject?: string;
}) {
  console.log(`[auto-reply] Email check: inboxId=${inboxId} from=${from} match=${inboxId === AUTO_REPLY_INBOX_ID}`);
  if (inboxId !== AUTO_REPLY_INBOX_ID) return;
  if (from === AUTO_REPLY_EMAIL) return; // prevent self-reply loop
  if (!config.agentmailApiKey) {
    console.log("[auto-reply] Email skipped: no agentmailApiKey");
    return;
  }

  fetch(`https://api.agentmail.to/v0/inboxes/${inboxId}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentmailApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: [from],
      subject: `Re: ${subject || "(no subject)"}`,
      body: timestamp(),
      attachments: [
        {
          filename: "auto-reply.txt",
          content: Buffer.from(`Auto-reply timestamp: ${new Date().toISOString()}\n`).toString("base64"),
          content_type: "text/plain",
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  })
    .then(() => console.log(`[auto-reply] Email → ${from}`))
    .catch((err) => console.error(`[auto-reply] Email failed: ${err.message}`));
}
