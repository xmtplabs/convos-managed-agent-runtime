#!/usr/bin/env node
/**
 * Send a plain email via AgentMail.
 * Usage: node scripts/send-email.mjs --to email@example.com --subject "Subject" --text "Body" [--html "<p>Body</p>"] [--attach path]
 * Env: AGENTMAIL_API_KEY (required), AGENTMAIL_INBOX_ID (required)
 */
import { AgentMailClient } from "agentmail";
import { readFileSync } from "fs";
import { resolve } from "path";

const apiKey = process.env.AGENTMAIL_API_KEY;
const inboxId = process.env.AGENTMAIL_INBOX_ID;

function usage() {
  console.error("Usage: node send-email.mjs --to <email> --subject <subject> --text <body> [--html <html>] [--attach <path>]");
  console.error("Env: AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID");
  process.exit(1);
}

const args = process.argv.slice(2);
let to, subject, text, html, attachPath;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--to") to = args[++i];
  else if (args[i] === "--subject") subject = args[++i];
  else if (args[i] === "--text") text = args[++i];
  else if (args[i] === "--html") html = args[++i];
  else if (args[i] === "--attach") attachPath = args[++i];
}

if (!to || !subject || text === undefined) usage();
if (!apiKey) {
  console.error("AGENTMAIL_API_KEY is required");
  process.exit(1);
}
if (!inboxId) {
  console.error("AGENTMAIL_INBOX_ID is required");
  process.exit(1);
}

const payload = {
  to,
  subject,
  text: text || "",
  html: html ?? `<p>${(text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
};
if (attachPath) {
  const abs = resolve(process.cwd(), attachPath);
  const raw = readFileSync(abs);
  const filename = attachPath.split("/").pop() || "attachment";
  const contentType = filename.endsWith(".ics") ? "text/calendar" : "application/octet-stream";
  payload.attachments = [
    { content: raw.toString("base64"), filename, contentType },
  ];
}

const client = new AgentMailClient({ apiKey });
await client.inboxes.messages.send(inboxId, payload);
console.log("Sent to", to);
