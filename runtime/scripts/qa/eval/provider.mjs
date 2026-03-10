// runtime/scripts/qa/eval/provider.mjs
// Custom Promptfoo provider for OpenClaw agent e2e eval.
// Creates a conversation, joins the runtime, sends messages via convos-cli,
// polls for agent responses.

import { execSync, execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENV = process.env.XMTP_ENV || 'dev';
const GATEWAY_PORT = process.env.GATEWAY_INTERNAL_PORT || '18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

// Resolve convos binary: container path, then relative to script, then PATH
function resolveConvos() {
  const candidates = [
    '/app/node_modules/.bin/convos',                        // Docker container
    resolve(__dirname, '../../../node_modules/.bin/convos'), // local (runtime/)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall back to PATH (works if node_modules/.bin is on PATH)
  return 'convos';
}

const CONVOS = resolveConvos();

// Eval's convos-cli uses a separate HOME so it gets its own ~/.convos identity,
// distinct from the gateway's agent identity.
const EVAL_HOME = mkdtempSync(join(tmpdir(), 'eval-convos-'));
const CONVOS_ENV = { ...process.env, HOME: EVAL_HOME };
// Share with assertions module via env var
process.env.EVAL_CONVOS_HOME = EVAL_HOME;
console.log(`[eval] Using separate identity store: ${EVAL_HOME}/.convos`);

// Clean up temp dir on exit (normal, Ctrl+C, or crash)
function cleanup() {
  try { rmSync(EVAL_HOME, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

// Check gateway is reachable before running any tests
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

function exec(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', timeout: 30_000, env: CONVOS_ENV, ...opts }).trim();
}

function setup() {
  // 0. Reset the runtime's convos identity so /join works on a fresh conversation
  console.log(`[eval] Resetting runtime convos identity...`);
  const resetOut = execFileSync('curl', [
    '-s', '-X', 'POST',
    `http://localhost:${GATEWAY_PORT}/convos/reset`,
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
    '-d', '{}',
  ], { encoding: 'utf-8', timeout: 30_000 }).trim();
  console.log(`[eval] Reset response: ${resetOut}`);

  // Wait for the gateway to finish reinitialising its convos agent after reset
  console.log(`[eval] Waiting for gateway to reinitialise...`);
  execSync('sleep 10');

  // 1. Create conversation via convos-cli (user identity)
  const createOut = exec(
    `${CONVOS} conversations create --name "QA Eval ${Date.now()}" --env ${ENV} --json`
  );
  const data = JSON.parse(createOut);
  sharedConversationId = data.conversationId;
  userInboxId = data.inboxId;
  const inviteUrl = data.invite.url;

  console.log(`[eval] Created conversation ${sharedConversationId}`);
  console.log(`[eval] User inboxId: ${userInboxId}`);

  // 2. Have the runtime join via POST /convos/join
  const joinBody = JSON.stringify({ inviteUrl, profileName: 'QA Eval Agent' });
  console.log(`[eval] Calling POST http://localhost:${GATEWAY_PORT}/convos/join`);
  console.log(`[eval] Token present: ${!!GATEWAY_TOKEN}, length: ${GATEWAY_TOKEN?.length}`);
  console.log(`[eval] Join body: ${joinBody.substring(0, 120)}...`);
  const joinOut = execFileSync('curl', [
    '-v',
    '-s', '-X', 'POST',
    `http://localhost:${GATEWAY_PORT}/convos/join`,
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${GATEWAY_TOKEN}`,
    '-d', joinBody,
  ], { encoding: 'utf-8', timeout: 90_000 }).trim();
  console.log(`[eval] Join response: ${joinOut}`);

  // 3. Wait for join to propagate
  execSync('sleep 5');
}

function pollForAgentResponse(afterTimestamp) {
  const deadline = Date.now() + 120_000; // 120s timeout
  const pollInterval = 3_000; // 3s between polls

  while (Date.now() < deadline) {
    const messagesOut = exec(
      `${CONVOS} conversation messages ${sharedConversationId} ` +
      `--sync --limit 5 --direction descending --env ${ENV} --json`,
      { timeout: 30_000 }
    );

    let messages;
    try {
      messages = JSON.parse(messagesOut);
    } catch {
      execSync(`sleep ${pollInterval / 1000}`);
      continue;
    }

    // Find first message from someone other than the user, after our send
    const agentMsg = (Array.isArray(messages) ? messages : []).find(
      (m) => m.senderInboxId !== userInboxId && new Date(m.sentAt).getTime() > afterTimestamp
    );

    if (agentMsg) {
      return agentMsg.content || agentMsg.text || JSON.stringify(agentMsg);
    }

    execSync(`sleep ${pollInterval / 1000}`);
  }

  throw new Error('Timed out waiting for agent response (120s)');
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
    const beforeSend = Date.now();

    // If there's an attachment, send it first
    if (vars.attachment) {
      const attachDir = new URL('.', import.meta.url).pathname;
      const attachPath = vars.attachment.startsWith('./')
        ? `${attachDir}${vars.attachment.slice(2)}`
        : vars.attachment;

      exec(
        `${CONVOS} conversation send-attachment ${sharedConversationId} ` +
        `${attachPath} --env ${ENV}`,
        { timeout: 30_000 }
      );
      console.log(`[eval] Sent attachment: ${vars.attachment}`);
      execSync('sleep 2'); // Brief pause between attachment and text
    }

    // Send the text prompt
    exec(
      `${CONVOS} conversation send-text ${sharedConversationId} ` +
      `${JSON.stringify(prompt)} --env ${ENV}`,
      { timeout: 30_000 }
    );
    console.log(`[eval] Sent prompt: ${prompt}`);

    // Poll for agent response
    try {
      const response = pollForAgentResponse(beforeSend);
      console.log(`[eval] Agent response: ${response.substring(0, 100)}...`);
      return {
        output: response,
        metadata: { conversationId: sharedConversationId },
      };
    } catch (err) {
      return {
        output: '',
        error: err.message,
        metadata: { conversationId: sharedConversationId },
      };
    }
  }
}
