#!/usr/bin/env node
/**
 * Email handler — send, send-calendar, poll, read, recent via AgentMail REST API.
 *
 * When POOL_URL and INSTANCE_ID are set, calls are proxied through the pool
 * manager (no API key needed on the instance). Otherwise falls back to direct
 * AgentMail API calls for local development.
 *
 * Usage:
 *   node services.mjs email send --to <email> --subject <subj> --text <body> [--html <html>] [--attach <path>]
 *   node services.mjs email send-calendar --to <email> --ics <path> [--subject <subj>]
 *   node services.mjs email poll [--limit 20] [--labels unread] [--threads]
 *   node services.mjs email read --id <messageId> [--save-dir <dir>]
 *   node services.mjs email recent [--since-last] [--limit 5] [--no-provision]
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { resolve } from "path";

// Proxy mode: route through pool manager (no API key on instance)
const POOL_URL = process.env.POOL_URL;
const INSTANCE_ID = process.env.INSTANCE_ID;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const useProxy = !!(POOL_URL && INSTANCE_ID && GATEWAY_TOKEN);

// Direct mode: call AgentMail API directly (local dev — requires AGENTMAIL_* env vars)
const DIRECT_API = "https://api.agentmail.to/v0";
const apiKey = process.env.AGENTMAIL_API_KEY;
const inboxId = process.env.AGENTMAIL_INBOX_ID;

/** Ensure email is available. Use --no-provision to silently exit when not provisioned. */
async function requireEnv({ noProvision = false } = {}) {
  if (!useProxy) {
    if (!apiKey) { console.error("Email service not configured: missing API key"); process.exit(1); }
    if (!inboxId) { console.error("Email service not configured: missing inbox"); process.exit(1); }
    return;
  }
  // Proxy mode — check if inbox exists
  const infoRes = await fetch(`${POOL_URL}/api/proxy/info`, {
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}` },
  });
  if (!infoRes.ok) return; // let the actual call fail with a clear error
  const info = await infoRes.json();
  if (info.email) return; // already provisioned

  // Not provisioned — either skip silently or fail
  if (noProvision) {
    process.exit(0);
  }
  console.error("Email not provisioned. Use the provision endpoint first.");
  process.exit(1);
}

async function api(method, path, body) {
  let url, headers;
  if (useProxy) {
    // Proxy: /api/proxy/email/send, /api/proxy/email/messages, etc.
    url = `${POOL_URL}${path}`;
    headers = {
      Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}`,
      "Content-Type": "application/json",
    };
  } else {
    // Direct: AgentMail API
    url = `${DIRECT_API}${path}`;
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`AgentMail ${res.status}: ${msg}`);
  }
  return data;
}

// In proxy mode, paths don't include inboxId (pool manager injects it)
function inboxPath(suffix) {
  if (useProxy) {
    // Proxy routes: /api/proxy/email/send, /api/proxy/email/messages, /api/proxy/email/threads
    // Strip "messages/" prefix for send since proxy has a dedicated /send route
    if (suffix === "messages/send") return "/api/proxy/email/send";
    return `/api/proxy/email/${suffix}`;
  }
  return `/inboxes/${inboxId}/${suffix}`;
}

function parseArgs(argv) {
  const map = {};
  const flags = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        map[key] = argv[++i];
      } else {
        flags.push(key);
      }
    }
  }
  return { map, flags };
}

async function send(argv) {
  const { map, flags } = parseArgs(argv);
  await requireEnv({ noProvision: flags.includes("no-provision") });
  const to = map.to;
  const subject = map.subject;
  const text = map.text;
  const html = map.html;
  const attachPath = map.attach;

  if (!to || !subject || text === undefined) {
    console.error("Usage: services.mjs email send --to <email> --subject <subj> --text <body> [--html <html>] [--attach <path>]");
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
    const content_type = filename.endsWith(".ics") ? "text/calendar" : "application/octet-stream";
    payload.attachments = [
      { content: raw.toString("base64"), filename, content_type },
    ];
  }

  await api("POST", inboxPath("messages/send"), payload);
  console.log("Sent to", to);
}

async function sendCalendar(argv) {
  const { map, flags } = parseArgs(argv);
  await requireEnv({ noProvision: flags.includes("no-provision") });
  const to = map.to;
  const icsPath = map.ics;
  const subject = map.subject || "Calendar invite";

  if (!to || !icsPath) {
    console.error("Usage: services.mjs email send-calendar --to <email> --ics <path> [--subject <subj>]");
    process.exit(1);
  }

  const icsAbs = resolve(process.cwd(), icsPath);
  const icsContent = readFileSync(icsAbs, "utf8");
  const content = Buffer.from(icsContent, "utf8").toString("base64");

  await api("POST", inboxPath("messages/send"), {
    to,
    subject,
    text: "Calendar invite attached. Open the .ics file to add to your calendar.",
    html: "<p>Calendar invite attached. Open the .ics file to add to your calendar.</p>",
    attachments: [
      { content, filename: "invite.ics", content_type: "text/calendar" },
    ],
  });

  console.log("Sent calendar invite to", to);
}

function markAsRead(messageId) {
  return api("PATCH", inboxPath(`messages/${encodeURIComponent(messageId)}`), { add_labels: ["read"], remove_labels: ["unread"] }).catch(() => {});
}

async function poll(argv) {
  const { map, flags } = parseArgs(argv);
  await requireEnv({ noProvision: flags.includes("no-provision") });
  const limit = parseInt(map.limit, 10) || 20;
  const labels = map.labels?.split(",").map((s) => s.trim()).filter(Boolean);
  const includeThreads = flags.includes("threads");

  const params = new URLSearchParams({ limit: String(limit) });
  if (labels?.length) labels.forEach((l) => params.append("labels", l));

  const out = { messages: [], threads: [] };

  const msgData = await api("GET", `${inboxPath("messages")}?${params}`);
  out.messages = msgData?.messages ?? [];

  if (includeThreads) {
    const threadParams = new URLSearchParams();
    threadParams.append("labels", "unreplied");
    const threadData = await api("GET", `${inboxPath("threads")}?${threadParams}`);
    out.threads = threadData?.threads ?? [];
  }

  if (flags.includes("json")) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const displayInbox = inboxId || "(proxy)";
  console.log(`Inbox ${displayInbox}: ${out.messages.length} message(s)\n`);
  for (const m of out.messages) {
    const dir = m.labels?.includes("received") ? "received" : "sent";
    console.log(`  ID:      ${m.message_id}`);
    console.log(`  Subject: ${m.subject || "(none)"}`);
    console.log(`  From:    ${m.from}`);
    console.log(`  To:      ${[].concat(m.to || []).join(", ")}`);
    console.log(`  Date:    ${m.timestamp}`);
    console.log(`  Status:  ${dir}`);
    if (m.attachments?.length) {
      const names = m.attachments.map((a) => a.filename || a.attachment_id).join(", ");
      console.log(`  Attachments: ${names}`);
      console.log(`  (use: email read --id "${m.message_id}" to download)`);
    }
    if (m.preview) console.log(`  Preview: ${m.preview.slice(0, 120)}`);
    console.log("");
  }

  // Mark displayed unread messages as read
  const unread = out.messages.filter((m) => m.labels?.includes("unread") && m.message_id);
  if (unread.length) {
    await Promise.all(unread.map((m) => markAsRead(m.message_id)));
    console.log(`Marked ${unread.length} message(s) as read.`);
  }
}

async function read(argv) {
  const { map, flags } = parseArgs(argv);
  await requireEnv({ noProvision: flags.includes("no-provision") });
  const messageId = map.id || map.message;

  if (!messageId) {
    console.error("Usage: services.mjs email read --id <messageId> [--save-dir <dir>]");
    process.exit(1);
  }

  const encodedId = encodeURIComponent(messageId);
  const message = await api("GET", inboxPath(`messages/${encodedId}`));

  markAsRead(messageId);

  console.log(`From: ${message.from}`);
  console.log(`To: ${[].concat(message.to || []).join(", ")}`);
  console.log(`Subject: ${message.subject || "(none)"}`);
  console.log(`Date: ${message.timestamp}`);
  if (message.text) console.log(`\nBody:\n${message.text}`);

  if (message.attachments?.length) {
    const defaultDir = resolve(process.env.OPENCLAW_STATE_DIR || "/tmp", "media");
    const saveDir = map["save-dir"] || defaultDir;
    mkdirSync(saveDir, { recursive: true });
    console.log(`\nAttachments (${message.attachments.length}):`);
    for (const att of message.attachments) {
      const filename = att.filename || att.attachment_id;
      const url = att.download_url || att.content;
      if (url && url.startsWith("http")) {
        // Signed CDN URL — download the file
        try {
          const dlRes = await fetch(url);
          if (dlRes.ok) {
            const outPath = resolve(saveDir, filename);
            writeFileSync(outPath, Buffer.from(await dlRes.arrayBuffer()));
            console.log(`  - ${filename} (${att.content_type || "unknown"}) → saved to ${outPath}`);
          } else {
            console.log(`  - ${filename} (${att.content_type || "unknown"}) — download failed (${dlRes.status})`);
          }
        } catch (e) {
          console.log(`  - ${filename} (${att.content_type || "unknown"}) — download error: ${e.message}`);
        }
      } else if (att.content) {
        // Base64 inline content (fallback)
        const outPath = resolve(saveDir, filename);
        writeFileSync(outPath, Buffer.from(att.content, "base64"));
        console.log(`  - ${filename} (${att.content_type || "unknown"}) → saved to ${outPath}`);
      } else {
        console.log(`  - ${filename} (${att.content_type || "unknown"}) — no download URL available`);
      }
    }
  }
}

const EMAIL_CURSOR_FILE = "/tmp/.heartbeat-email-cursor";

function readCursor() {
  try {
    const ts = parseInt(readFileSync(EMAIL_CURSOR_FILE, "utf8").trim(), 10);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeCursor(ts) {
  try { writeFileSync(EMAIL_CURSOR_FILE, String(ts), "utf8"); } catch {}
}

async function recent(argv) {
  const { map, flags } = parseArgs(argv);
  await requireEnv({ noProvision: flags.includes("no-provision") });
  const minutes = map.minutes ? parseInt(map.minutes, 10) : null;
  const sinceLast = flags.includes("since-last");
  const limit = parseInt(map.limit, 10) || 5;

  let cutoff;
  if (sinceLast) {
    cutoff = readCursor();
    if (cutoff === 0) cutoff = Date.now() - 30 * 60 * 1000; // first run: 30min fallback
  } else {
    cutoff = Date.now() - (minutes || 30) * 60 * 1000;
  }

  const params = new URLSearchParams({ limit: "20" });
  params.append("labels", "unread");
  const msgData = await api("GET", `${inboxPath("messages")}?${params}`);
  const all = msgData?.messages ?? [];
  const messages = all.filter((m) => {
    const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
    return ts > cutoff && m.labels?.includes("received");
  }).slice(0, limit);

  if (sinceLast && messages.length > 0) {
    // Advance cursor to the newest message we reported
    const newest = messages.reduce((max, m) => {
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      return ts > max ? ts : max;
    }, cutoff);
    writeCursor(newest);
  }

  if (messages.length === 0) {
    console.log("No new emails.");
    return;
  }

  for (const m of messages) {
    console.log(`From: ${m.from}`);
    console.log(`Subject: ${m.subject || "(none)"}`);
    console.log(`Date: ${m.timestamp}`);
    const preview = (m.preview || "").split("\n")[0].slice(0, 120);
    console.log(`Body: ${preview || "(no preview)"}`);
    if (m.attachments?.length) {
      const names = m.attachments.map((a) => a.filename || a.attachment_id).join(", ");
      console.log(`Attachments: ${names}`);
    }
    console.log("");
  }
}

async function provision() {
  if (!useProxy) {
    console.log("Email provisioning is only available in proxy mode (pool-managed instances).");
    process.exit(1);
  }
  // Check if already provisioned
  const infoRes = await fetch(`${POOL_URL}/api/proxy/info`, {
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}` },
  });
  if (infoRes.ok) {
    const info = await infoRes.json();
    if (info.email) {
      console.log(`Email already provisioned: ${info.email}`);
      return;
    }
  }
  // Provision
  const provRes = await fetch(`${POOL_URL}/api/proxy/email/provision`, {
    method: "POST",
    headers: { Authorization: `Bearer ${INSTANCE_ID}:${GATEWAY_TOKEN}`, "Content-Type": "application/json" },
  });
  if (!provRes.ok) {
    const err = await provRes.json().catch(() => ({}));
    console.error(`Email provisioning failed: ${err.error || provRes.status}`);
    process.exit(1);
  }
  const result = await provRes.json();
  console.log(`Email provisioned: ${result.email}`);

  // Update profile metadata so the conversation shows the email
  const convoId = process.env.CONVOS_CONVERSATION_ID;
  const convoEnv = process.env.CONVOS_ENV || process.env.XMTP_ENV;
  if (convoId && result.email) {
    try {
      execFileSync("convos", [
        "conversation", "update-profile", convoId,
        "--metadata", `email=${result.email}`,
        ...(convoEnv ? ["--env", convoEnv] : []),
      ], { timeout: 15_000, stdio: "ignore" });
    } catch { /* best-effort */ }
  }
}

export default async function email(argv) {
  const [action, ...rest] = argv;

  switch (action) {
    case "provision":     return provision();
    case "send":          return send(rest);
    case "send-calendar": return sendCalendar(rest);
    case "poll":          return poll(rest);
    case "recent":        return recent(rest);
    case "read":          return read(rest);
    default:
      console.error("Usage: services.mjs email <provision|send|send-calendar|poll|recent|read> [options]");
      process.exit(1);
  }
}
