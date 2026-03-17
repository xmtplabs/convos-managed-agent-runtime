// runtime/evals/poller.provider.mjs
// E2E eval for the email poller pipeline:
//   self-send email with attachment → poller detects it → notification in XMTP → agent answers about attachment.
// OpenClaw only.

import { execSync, execFileSync, spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { resolveConvos, sleep, elapsed, log as _log } from '../lib/utils.mjs';
import { runtime } from '../lib/runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENV = process.env.XMTP_ENV || 'dev';
const GATEWAY_PORT = process.env.POOL_SERVER_PORT || process.env.PORT || process.env.GATEWAY_INTERNAL_PORT || runtime.defaultPort;
let GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!GATEWAY_TOKEN && !runtime.gateway) {
  console.error('[eval:poller] OPENCLAW_GATEWAY_TOKEN is required. Set it in runtime/.env.');
  process.exit(1);
}

const AGENTMAIL_INBOX_ID = process.env.AGENTMAIL_INBOX_ID;
if (!AGENTMAIL_INBOX_ID) {
  console.error('[eval:poller] AGENTMAIL_INBOX_ID is required. Set it in runtime/.env.');
  process.exit(1);
}

const CONVOS = resolveConvos();

const EVAL_HOME = mkdtempSync(join(tmpdir(), 'eval-poller-'));
const CONVOS_ENV = { ...process.env, HOME: EVAL_HOME };
process.env.EVAL_CONVOS_HOME = EVAL_HOME;
log(`Using identity store: ${EVAL_HOME}/.convos`);

// Resolve paths — Docker copies shared dirs to /app/shared-workspace and /app/shared-scripts
const FIXTURE_PATH = resolve(__dirname, '../fixtures/eval-poller-note.txt');
const SKILLS_ROOT = existsSync('/app/shared-workspace/skills')
  ? '/app/shared-workspace/skills'
  : resolve(__dirname, '../../shared/workspace/skills');
const POLLER_SCRIPT = existsSync('/app/shared-scripts/poller.sh')
  ? '/app/shared-scripts/poller.sh'
  : resolve(__dirname, '../../shared/scripts/poller.sh');
const SERVICES_MJS = resolve(SKILLS_ROOT, 'services/scripts/services.mjs');

let pollerProc = null;

function cleanup() {
  if (pollerProc) { try { pollerProc.kill('SIGKILL'); } catch {} pollerProc = null; }
  if (runtime.gateway) { try { runtime.gateway.stop(); } catch {} }
  try { rmSync(EVAL_HOME, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

function checkGateway() {
  try {
    execFileSync('curl', ['-sf', `http://localhost:${GATEWAY_PORT}${runtime.healthPath}`],
      { encoding: 'utf-8', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function log(msg) { _log('eval:poller', msg); }

function convos(args, opts = {}) {
  return execFileSync(CONVOS, args, { encoding: 'utf-8', timeout: 30_000, env: CONVOS_ENV, ...opts }).trim();
}

// Start the gateway if the runtime adapter provides one, otherwise expect it running.
if (runtime.gateway) {
  log('Starting server...');
  runtime.gateway.start(GATEWAY_PORT);
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    sleep(1_000);
    if (checkGateway()) { ready = true; break; }
  }
  if (!ready) {
    console.error('[eval:poller] Server failed to start on port ' + GATEWAY_PORT + ' within 30s.');
    runtime.gateway.stop();
    process.exit(1);
  }
  GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
  log('Server ready.');
} else if (!checkGateway()) {
  console.error(`[eval:poller] Gateway not reachable at localhost:${GATEWAY_PORT}. Start it first (pnpm gateway).`);
  process.exit(1);
}

let sharedConversationId = null;
let userInboxId = null;
let testIndex = 0;

function setup() {
  const t = Date.now();

  log('Resetting agent identity...');
  execFileSync('curl', [
    '-s', '-X', 'POST',
    `http://localhost:${GATEWAY_PORT}/convos/reset`,
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
    '-d', '{}',
  ], { encoding: 'utf-8', timeout: 30_000 });
  log('Waiting for gateway to reinitialise (10s)...');
  sleep(10_000);

  log('Creating conversation...');
  const createOut = convos([
    'conversations', 'create', '--name', `Poller Eval ${Date.now()}`, '--env', ENV, '--json',
  ]);
  const data = JSON.parse(createOut);
  if (!data.invite?.url) {
    throw new Error(`Missing invite URL in conversation create response: ${createOut}`);
  }
  sharedConversationId = data.conversationId;
  userInboxId = data.inboxId;
  log(`Conversation created: ${sharedConversationId}`);

  log('Joining agent to conversation...');
  const watcher = spawn(CONVOS, [
    'conversations', 'process-join-requests',
    '--conversation', sharedConversationId,
    '--watch', '--env', ENV,
  ], { env: CONVOS_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    sleep(3_000);
    execFileSync('curl', [
      '-s', '-X', 'POST',
      `http://localhost:${GATEWAY_PORT}/convos/join`,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
      '-d', JSON.stringify({ inviteUrl: data.invite.url, profileName: 'Poller Eval Agent' }),
    ], { encoding: 'utf-8', timeout: 90_000 });
  } finally {
    try { watcher.kill(); } catch {}
  }

  sleep(5_000);

  // Start the poller process
  log('Starting poller...');
  pollerProc = spawn('sh', [POLLER_SCRIPT], {
    env: {
      ...process.env,
      HOME: EVAL_HOME,
      CONVOS_CONVERSATION_ID: sharedConversationId,
      CONVOS_ENV: ENV,
      POLL_INTERVAL_SECONDS: '10',
      SKILLS_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pollerProc.stdout.on('data', (d) => { process.stdout.write(d); });
  pollerProc.stderr.on('data', (d) => { process.stderr.write(d); });

  // Wait for poller 15s startup delay + buffer
  log('Waiting 18s for poller startup...');
  sleep(18_000);

  // Send the test email with attachment
  log(`Sending test email to ${AGENTMAIL_INBOX_ID} with attachment...`);
  try {
    execFileSync('node', [
      SERVICES_MJS, 'email', 'send',
      '--to', AGENTMAIL_INBOX_ID,
      '--subject', 'Poller eval test',
      '--text', 'Hello from poller eval. This is a test email with an attachment.',
      '--attach', FIXTURE_PATH,
    ], { encoding: 'utf-8', timeout: 30_000, env: process.env });
    log('Test email sent.');
  } catch (err) {
    log(`WARNING: email send failed: ${err.message}`);
  }

  log(`Setup complete (${elapsed(t)})\n`);
}

function fetchMessages() {
  const out = convos([
    'conversation', 'messages', sharedConversationId,
    '--sync', '--limit', '50', '--direction', 'ascending', '--env', ENV, '--json',
  ], { timeout: 30_000 });
  const msgs = JSON.parse(out);
  return Array.isArray(msgs) ? msgs : [];
}

function isSystemMsg(m) {
  if (!m.contentType) return false;
  const typeId = typeof m.contentType === 'string' ? m.contentType : m.contentType.typeId;
  return typeId && typeId !== 'text';
}

function isAgentReply(m) {
  return m.senderInboxId !== userInboxId && !isSystemMsg(m);
}

function agentCount(msgs) {
  return msgs.filter(isAgentReply).length;
}

function waitForAgent(baseline) {
  const deadline = Date.now() + 120_000;
  let msgs = [];
  try { msgs = fetchMessages(); } catch {}
  let count = agentCount(msgs);
  let lastChange = Date.now();
  log(`waitForAgent: baseline=${baseline} initial count=${count} total=${msgs.length}`);

  while (Date.now() < deadline) {
    sleep(3_000);
    try { msgs = fetchMessages(); } catch { continue; }
    const n = agentCount(msgs);
    if (n !== count) {
      log(`waitForAgent: agent count ${count} → ${n} (total=${msgs.length})`);
    }
    if (n > count) {
      count = n;
      lastChange = Date.now();
    } else if (count > baseline && Date.now() - lastChange >= 5_000) {
      log(`waitForAgent: stable at count=${count} — done`);
      return msgs;
    }
  }
  log(`waitForAgent: timed out — final count=${count} baseline=${baseline}`);
  return msgs;
}

// Wait for a specific content pattern in the transcript (polls every 5s, up to timeoutMs).
function waitForContent(pattern, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    sleep(5_000);
    try {
      const msgs = fetchMessages();
      const text = transcript(msgs);
      if (pattern.test(text)) {
        log(`Content matched: ${pattern}`);
        return { msgs, text };
      }
    } catch {}
  }
  log(`Content NOT matched within ${timeoutMs / 1000}s: ${pattern}`);
  const msgs = fetchMessages();
  return { msgs, text: transcript(msgs) };
}

function transcript(msgs, afterIndex = 0) {
  return msgs.slice(afterIndex)
    .filter((m) => {
      if (!m.contentType) return true;
      const typeId = typeof m.contentType === 'string' ? m.contentType : m.contentType.typeId;
      return typeId === 'text';
    })
    .map((m) => {
      const who = m.senderInboxId === userInboxId ? 'USER' : 'AGENT';
      return `[${who}] ${m.content || m.text || JSON.stringify(m)}`;
    }).join('\n');
}

export default class PollerProvider {
  id() { return 'openclaw-poller'; }

  async callApi(prompt, context) {
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    if (!sharedConversationId) setup();

    // Test 1: Wait for poller notification to appear in transcript, then wait
    // for the agent to finish processing it before returning — so test 2 doesn't
    // fire while the agent is still busy with the notification.
    if (meta.waitForNotification) {
      const { msgs: notifMsgs } = waitForContent(/You got a new email/i, 120_000);
      const notifBaseline = agentCount(notifMsgs);
      log(`Notification matched — agent count=${notifBaseline} total=${notifMsgs.length}`);
      log(`Waiting for agent to finish processing notification...`);
      waitForAgent(notifBaseline - 1);
      const finalMsgs = fetchMessages();
      log(`After wait — agent count=${agentCount(finalMsgs)} total=${finalMsgs.length}`);
      log(`Transcript:\n${transcript(finalMsgs)}`);
      const text = transcript(finalMsgs);
      log(`Notification test done (${elapsed(t)})`);
      return { output: text, metadata: { conversationId: sharedConversationId } };
    }

    // Test 2+: Send prompt and wait for agent reply
    const existing = fetchMessages();
    const baseline = agentCount(existing);
    const msgsBefore = existing.length;
    log(`Pre-send state — agent count=${baseline} total=${msgsBefore}`);
    log(`Transcript so far:\n${transcript(existing)}`);

    log(`Sending: "${prompt}"`);
    convos(['conversation', 'send-text', sharedConversationId, prompt, '--env', ENV], { timeout: 30_000 });
    log(`Message sent — waiting for agent reply (baseline=${baseline})...`);

    const msgs = waitForAgent(baseline);
    const output = transcript(msgs, msgsBefore);
    log(`Output transcript:\n${output || '(empty)'}`);

    const last = msgs.filter((m) => m.senderInboxId !== userInboxId).pop();
    const preview = last ? (last.content || last.text || '').slice(0, 120) : '(no response)';
    log(`Agent replied (${elapsed(t)}): ${preview}${preview.length >= 120 ? '...' : ''}`);

    return { output, metadata: { conversationId: sharedConversationId } };
  }
}
