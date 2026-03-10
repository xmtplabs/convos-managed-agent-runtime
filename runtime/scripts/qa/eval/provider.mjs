// runtime/scripts/qa/eval/provider.mjs
// Custom Promptfoo provider for OpenClaw agent e2e eval.
// Creates a conversation, joins the runtime, sends messages via convos-cli,
// waits for the agent, then returns the full transcript for LLM-judge evaluation.

import { execSync, execFileSync, spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveConvos } from './utils.mjs';

const ENV = process.env.XMTP_ENV || 'dev';
const GATEWAY_PORT = process.env.GATEWAY_INTERNAL_PORT || '18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!GATEWAY_TOKEN) {
  console.error('[eval] OPENCLAW_GATEWAY_TOKEN is required. Set it in runtime/.env.');
  process.exit(1);
}

const CONVOS = resolveConvos();

// Eval's convos-cli uses a separate HOME so it gets its own ~/.convos identity,
// distinct from the gateway's agent identity.
const EVAL_HOME = mkdtempSync(join(tmpdir(), 'eval-convos-'));
const CONVOS_ENV = { ...process.env, HOME: EVAL_HOME };
process.env.EVAL_CONVOS_HOME = EVAL_HOME;
console.log(`[eval] Using separate identity store: ${EVAL_HOME}/.convos`);

function cleanup() {
  try { rmSync(EVAL_HOME, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

function checkGateway() {
  try {
    execFileSync('curl', ['-sf', `http://localhost:${GATEWAY_PORT}/pool/health`],
      { encoding: 'utf-8', timeout: 5_000 }
    );
  } catch {
    console.error(`[eval] Gateway not reachable at localhost:${GATEWAY_PORT}. Start it first (pnpm gateway).`);
    process.exit(1);
  }
}

checkGateway();

let sharedConversationId = null;
let userInboxId = null;
let messageCountAtLastCheck = 0;

function convos(args, opts = {}) {
  return execFileSync(CONVOS, args, { encoding: 'utf-8', timeout: 30_000, env: CONVOS_ENV, ...opts }).trim();
}

function setup() {
  console.log(`[eval] Resetting runtime convos identity...`);
  const resetOut = execFileSync('curl', [
    '-s', '-X', 'POST',
    `http://localhost:${GATEWAY_PORT}/convos/reset`,
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
    '-d', '{}',
  ], { encoding: 'utf-8', timeout: 30_000 }).trim();
  console.log(`[eval] Reset response: ${resetOut}`);

  console.log(`[eval] Waiting for gateway to reinitialise...`);
  execSync('sleep 10');

  const createOut = convos([
    'conversations', 'create', '--name', `QA Eval ${Date.now()}`, '--env', ENV, '--json',
  ]);
  const data = JSON.parse(createOut);
  if (!data.invite?.url) {
    throw new Error(`Missing invite URL in conversation create response: ${createOut}`);
  }
  sharedConversationId = data.conversationId;
  userInboxId = data.inboxId;
  const inviteUrl = data.invite.url;

  console.log(`[eval] Created conversation ${sharedConversationId}`);
  console.log(`[eval] User inboxId: ${userInboxId}`);

  console.log(`[eval] Starting process-join-requests --watch in background...`);
  const processChild = spawn(CONVOS, [
    'conversations', 'process-join-requests',
    '--conversation', sharedConversationId,
    '--watch',
    '--env', ENV,
  ], { env: CONVOS_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  processChild.stdout.on('data', (d) => console.log(`[eval] process-join-requests: ${d.toString().trim()}`));
  processChild.stderr.on('data', (d) => console.log(`[eval] process-join-requests stderr: ${d.toString().trim()}`));

  try {
    execSync('sleep 3');

    const joinBody = JSON.stringify({ inviteUrl, profileName: 'QA Eval Agent' });
    console.log(`[eval] Calling /convos/join...`);
    const joinOut = execFileSync('curl', [
      '-s', '-X', 'POST',
      `http://localhost:${GATEWAY_PORT}/convos/join`,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
      '-d', joinBody,
    ], { encoding: 'utf-8', timeout: 90_000 }).trim();
    console.log(`[eval] Join response: ${joinOut}`);
  } finally {
    try { processChild.kill(); } catch {}
  }

  execSync('sleep 5');
}

function fetchMessages() {
  const out = convos([
    'conversation', 'messages', sharedConversationId,
    '--sync', '--limit', '50', '--direction', 'ascending', '--env', ENV, '--json',
  ], { timeout: 30_000 });
  const messages = JSON.parse(out);
  return Array.isArray(messages) ? messages : [];
}

function agentMessageCount(messages) {
  return messages.filter((m) => m.senderInboxId !== userInboxId).length;
}

// Wait for the agent to send at least one new message, then settle.
// Returns the final message array for transcript building.
function waitForAgent() {
  const deadline = Date.now() + 120_000;
  const settleTime = 8_000;
  let lastChangeAt = Date.now();
  let messages = [];
  try { messages = fetchMessages(); } catch {}
  let currentCount = agentMessageCount(messages);

  while (Date.now() < deadline) {
    execSync('sleep 3');
    try { messages = fetchMessages(); } catch { continue; }
    const newCount = agentMessageCount(messages);
    if (newCount > currentCount) {
      currentCount = newCount;
      lastChangeAt = Date.now();
    } else if (currentCount > messageCountAtLastCheck && Date.now() - lastChangeAt >= settleTime) {
      messageCountAtLastCheck = currentCount;
      return messages;
    }
  }
  messageCountAtLastCheck = currentCount;
  return messages;
}

function buildTranscript(messages) {
  return messages.map((m) => {
    const sender = m.senderInboxId === userInboxId ? 'USER' : 'AGENT';
    const content = m.content || m.text || JSON.stringify(m);
    return `[${sender}] ${content}`;
  }).join('\n');
}

export default class OpenClawProvider {
  id() {
    return 'openclaw-agent';
  }

  async callApi(prompt, context) {
    if (!sharedConversationId) {
      setup();
    }

    const vars = context.vars || {};

    // For the welcome message test, just wait for the agent to send something
    if (!vars.waitForWelcome) {
      // Send attachment if present
      if (vars.attachment) {
        const attachDir = new URL('.', import.meta.url).pathname;
        const attachPath = vars.attachment.startsWith('./')
          ? `${attachDir}${vars.attachment.slice(2)}`
          : vars.attachment;
        convos([
          'conversation', 'send-attachment', sharedConversationId,
          attachPath, '--env', ENV,
        ], { timeout: 30_000 });
        console.log(`[eval] Sent attachment: ${vars.attachment}`);
        execSync('sleep 2');
      }

      // Send the text prompt
      convos([
        'conversation', 'send-text', sharedConversationId,
        prompt, '--env', ENV,
      ], { timeout: 30_000 });
      console.log(`[eval] Sent prompt: ${prompt}`);
    } else {
      console.log(`[eval] Waiting for welcome message...`);
    }

    // Wait for the agent to respond and settle, then build transcript
    const messages = waitForAgent();
    const transcript = buildTranscript(messages);
    console.log(`[eval] Transcript length: ${transcript.length} chars`);
    return {
      output: transcript,
      metadata: { conversationId: sharedConversationId },
    };
  }
}
