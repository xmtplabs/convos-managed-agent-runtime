#!/usr/bin/env node
/**
 * Poll inbox messages and/or unreplied threads via AgentMail. Outputs JSON for the agent.
 * Usage: node scripts/poll-inbox.mjs [--limit 20] [--labels unread] [--threads]
 *   --labels unread   = new/unread emails
 *   --threads        = include threads that need a reply (unreplied)
 * Env: AGENTMAIL_API_KEY (required), AGENTMAIL_INBOX_ID (required)
 */
import { AgentMailClient } from "agentmail";

const apiKey = process.env.AGENTMAIL_API_KEY;
const inboxId = process.env.AGENTMAIL_INBOX_ID;

function usage() {
  console.error("Usage: node poll-inbox.mjs [--limit <n>] [--labels <label1,label2>] [--threads]");
  console.error("  --labels unread  new/unread emails");
  console.error("  --threads       include unreplied threads (replies to act on)");
  console.error("Env: AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID");
  process.exit(1);
}

const args = process.argv.slice(2);
let limit = 20;
let labels;
let includeThreads = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--limit") limit = parseInt(args[++i], 10) || 20;
  else if (args[i] === "--labels") labels = args[++i]?.split(",").map((s) => s.trim()).filter(Boolean);
  else if (args[i] === "--threads") includeThreads = true;
}

if (!apiKey) {
  console.error("AGENTMAIL_API_KEY is required");
  process.exit(1);
}
if (!inboxId) {
  console.error("AGENTMAIL_INBOX_ID is required");
  process.exit(1);
}

function normalizeList(raw) {
  return Array.isArray(raw)
    ? raw
    : raw?.data?.messages ?? raw?.messages ?? raw?.data?.threads ?? raw?.threads ?? [];
}

const client = new AgentMailClient({ apiKey });
const out = { messages: [], threads: [] };

const listOpts = { inboxId, limit };
if (labels?.length) listOpts.labels = labels;
const rawMessages = await client.inboxes.messages.list(listOpts);
out.messages = normalizeList(rawMessages);

if (includeThreads) {
  const rawThreads = await client.inboxes.threads.list({
    inboxId,
    labels: ["unreplied"],
  });
  out.threads = normalizeList(rawThreads);
}

console.log(JSON.stringify(out, null, 2));
