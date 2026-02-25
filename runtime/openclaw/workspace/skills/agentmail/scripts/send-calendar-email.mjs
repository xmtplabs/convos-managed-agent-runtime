#!/usr/bin/env node
/**
 * Send a calendar invite (ICS file) to an email address via AgentMail.
 * Usage: node scripts/send-calendar-email.mjs --to email@example.com --ics /path/to/file.ics [--subject "Event name"]
 * Env: AGENTMAIL_API_KEY (required), AGENTMAIL_INBOX_ID (required; the "from" inbox)
 */
import { AgentMailClient } from "agentmail";
import { readFileSync } from "fs";
import { resolve } from "path";

const apiKey = process.env.AGENTMAIL_API_KEY;
const inboxId = process.env.AGENTMAIL_INBOX_ID;

function usage() {
  console.error("Usage: node send-calendar-email.mjs --to <email> --ics <path> [--subject <subject>]");
  console.error("Env: AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID");
  process.exit(1);
}

const args = process.argv.slice(2);
let to, icsPath, subject;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--to") to = args[++i];
  else if (args[i] === "--ics") icsPath = args[++i];
  else if (args[i] === "--subject") subject = args[++i];
}

if (!to || !icsPath) usage();
if (!apiKey) {
  console.error("AGENTMAIL_API_KEY is required");
  process.exit(1);
}
if (!inboxId) {
  console.error("AGENTMAIL_INBOX_ID is required (create an inbox at AgentMail and set this env)");
  process.exit(1);
}

const icsAbs = resolve(process.cwd(), icsPath);
const icsContent = readFileSync(icsAbs, "utf8");
const content = Buffer.from(icsContent, "utf8").toString("base64");
const client = new AgentMailClient({ apiKey });

const subj = subject || "Calendar invite";

await client.inboxes.messages.send(inboxId, {
  to,
  subject: subj,
  text: `Calendar invite attached. Open the .ics file to add to your calendar.`,
  html: `<p>Calendar invite attached. Open the .ics file to add to your calendar.</p>`,
  attachments: [
    { content, filename: "invite.ics", contentType: "text/calendar" },
  ],
});

console.log("Sent calendar invite to", to);
