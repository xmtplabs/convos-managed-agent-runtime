// runtime/evals/convos.provider.mjs
// Custom Promptfoo provider for OpenClaw agent e2e eval.
// Creates a conversation, joins the runtime, sends messages via convos-cli,
// waits for the agent, then returns the transcript for assertion.

import { execSync, execFileSync, spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { resolveConvos, sleep, elapsed, log as _log } from '../lib/utils.mjs';
import { runtime } from '../lib/runtime.mjs';

const ENV = process.env.XMTP_ENV || 'dev';
const GATEWAY_PORT = process.env.POOL_SERVER_PORT || process.env.PORT || process.env.GATEWAY_INTERNAL_PORT || runtime.defaultPort;
let GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!GATEWAY_TOKEN) {
  console.error('[eval] OPENCLAW_GATEWAY_TOKEN is required. Set it in runtime/.env.');
  process.exit(1);
}

const CONVOS = resolveConvos();

const EVAL_HOME = mkdtempSync(join(tmpdir(), 'eval-convos-'));
const CONVOS_ENV = { ...process.env, HOME: EVAL_HOME };
// Export so assertions.mjs can use the same identity
process.env.EVAL_CONVOS_HOME = EVAL_HOME;
log(`Using identity store: ${EVAL_HOME}/.convos`);

function cleanup() {
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

// Expect the server to be running already (pnpm start:hermes or pnpm gateway).
if (!checkGateway()) {
  console.error(`[eval] Gateway not reachable at localhost:${GATEWAY_PORT}. Start it first.`);
  process.exit(1);
}

let sharedConversationId = null;
let userInboxId = null;
let testIndex = 0;

function log(msg) { _log('eval', msg); }

function convos(args, opts = {}) {
  return execFileSync(CONVOS, args, { encoding: 'utf-8', timeout: 30_000, env: CONVOS_ENV, ...opts }).trim();
}

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
    'conversations', 'create', '--name', `QA Eval ${Date.now()}`, '--env', ENV, '--json',
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
      '-d', JSON.stringify({ inviteUrl: data.invite.url, profileName: 'QA Eval Agent' }),
    ], { encoding: 'utf-8', timeout: 90_000 });
  } finally {
    try { watcher.kill(); } catch {}
  }

  sleep(5_000);
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
  // Filter by contentType — anything that isn't 'text' is a system message.
  // contentType may be a string ("text") or an object ({ typeId: "text", ... }).
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

// Wait for at least one new agent message after `baseline`, then settle.
function waitForAgent(baseline) {
  const deadline = Date.now() + 60_000;
  let msgs = [];
  try { msgs = fetchMessages(); } catch {}
  let count = agentCount(msgs);
  let lastChange = Date.now();

  while (Date.now() < deadline) {
    sleep(3_000);
    try { msgs = fetchMessages(); } catch { continue; }
    const n = agentCount(msgs);
    if (n > count) {
      count = n;
      lastChange = Date.now();
    } else if (count > baseline && Date.now() - lastChange >= 5_000) {
      return msgs;
    }
  }
  return msgs;
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

export default class ConvosProvider {
  id() { return 'convos'; }

  async callApi(prompt, context) {
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    if (!sharedConversationId) setup();

    const meta = context.test?.metadata || {};

    // Self-destruct: remove agent, verify shutdown
    if (meta.selfDestruct) {
      const result = handleSelfDestruct();
      log(`${result.output === 'SELF_DESTRUCT_CONFIRMED' ? 'OK' : 'FAIL'} ${desc} (${elapsed(t)})`);
      return result;
    }

    let baseline = 0;
    let msgsBefore = 0;

    if (!meta.waitForWelcome) {
      const existing = fetchMessages();
      baseline = agentCount(existing);
      msgsBefore = existing.length;

      if (meta.attachment) {
        const dir = new URL('.', import.meta.url).pathname;
        const path = meta.attachment.startsWith('/') ? meta.attachment : resolve(dir, meta.attachment);
        log(`Sending attachment: ${meta.attachment}`);
        convos(['conversation', 'send-attachment', sharedConversationId, path, '--env', ENV], { timeout: 30_000 });
        sleep(1_000);
      }

      log(`Sending: "${prompt}"`);
      convos(['conversation', 'send-text', sharedConversationId, prompt, '--env', ENV], { timeout: 30_000 });
    } else {
      log('Waiting for agent welcome message...');
    }

    const msgs = waitForAgent(baseline);
    const newAgentMsgs = agentCount(msgs) - baseline;

    // Fail fast on welcome — if agent never responded, everything else will fail
    if (meta.waitForWelcome && agentCount(msgs) === 0) {
      log('ABORT — agent never responded. Check gateway logs.');
      throw new Error('Agent never sent a welcome message. Check gateway logs. Aborting eval.');
    }

    // Only return this test's messages (after baseline) for focused assertions
    const output = transcript(msgs, meta.waitForWelcome ? 0 : msgsBefore);

    const last = msgs.filter((m) => m.senderInboxId !== userInboxId).pop();
    const preview = last ? (last.content || last.text || '').slice(0, 120) : '(no response)';
    log(`Agent replied (${newAgentMsgs} msg, ${elapsed(t)}): ${preview}${preview.length >= 120 ? '...' : ''}`);

    return { output, metadata: { conversationId: sharedConversationId } };
  }
}

function handleSelfDestruct() {
  log('Looking up agent profile...');
  const data = JSON.parse(convos([
    'conversation', 'profiles', sharedConversationId, '--env', ENV, '--json',
  ], { timeout: 30_000 }));
  const profiles = data.profiles || [];
  const agent = profiles.find((p) => p.inboxId !== userInboxId);

  if (!agent) {
    log('FAIL — could not find agent profile');
    return { output: 'SELF_DESTRUCT_FAILED: no agent profile', metadata: { conversationId: sharedConversationId } };
  }

  log('Removing agent from group...');
  try {
    convos(['conversation', 'remove-members', sharedConversationId, agent.inboxId, '--env', ENV], { timeout: 30_000 });
  } catch (err) {
    log(`FAIL — remove-members: ${err.message}`);
    return { output: `SELF_DESTRUCT_FAILED: ${err.message}`, metadata: { conversationId: sharedConversationId } };
  }

  log('Polling /convos/status for shutdown...');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    sleep(1_000);
    try {
      const out = execFileSync('curl', [
        '-sf', '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
        `http://localhost:${GATEWAY_PORT}/convos/status`,
      ], { encoding: 'utf-8', timeout: 5_000 });
      const s = JSON.parse(out);
      if (s.conversationId === null || s.conversationId === undefined) {
        return { output: 'SELF_DESTRUCT_CONFIRMED', metadata: { conversationId: sharedConversationId } };
      }
    } catch {
      // Gateway exited — counts as self-destruct
      return { output: 'SELF_DESTRUCT_CONFIRMED', metadata: { conversationId: sharedConversationId } };
    }
  }
  return { output: 'SELF_DESTRUCT_FAILED: instance still active', metadata: { conversationId: sharedConversationId } };
}
