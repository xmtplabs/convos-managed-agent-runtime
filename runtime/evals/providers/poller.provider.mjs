// runtime/evals/poller.provider.mjs
// E2E eval for the email poller pipeline:
//   self-send email with attachment → poller detects it → notification in XMTP → agent answers about attachment.

import { execFileSync, spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHarness, resolveSkillsRoot, resolvePollerScript } from '../lib/convos-harness.mjs';
import { sleep, elapsed } from '../lib/utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AGENTMAIL_INBOX_ID = process.env.AGENTMAIL_INBOX_ID;
if (!AGENTMAIL_INBOX_ID) {
  console.error('[eval:poller] AGENTMAIL_INBOX_ID is required. Set it in runtime/.env.');
  process.exit(1);
}

const FIXTURE_PATH = resolve(__dirname, '../fixtures/eval-poller-note.txt');
const SKILLS_ROOT = resolveSkillsRoot();
const POLLER_SCRIPT = resolvePollerScript();
const SERVICES_MJS = resolve(SKILLS_ROOT, 'services/scripts/services.mjs');

let pollerProc = null;

const h = createHarness('poller', {
  conversationPrefix: 'Poller Eval',
  cleanup() {
    if (pollerProc) { try { pollerProc.kill('SIGKILL'); } catch {} pollerProc = null; }
  },
  afterSetup({ sharedConversationId, EVAL_HOME, log }) {
    // Extra wait for gateway (poller setup needs more time)
    sleep(3_000);

    log('Starting poller...');
    pollerProc = spawn('sh', [POLLER_SCRIPT], {
      env: {
        ...process.env,
        HOME: EVAL_HOME,
        PORT: String(h.gatewayPort),
        POLL_INTERVAL_SECONDS: '10',
        SKILLS_ROOT,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pollerProc.stdout.on('data', (d) => { process.stdout.write(d); });
    pollerProc.stderr.on('data', (d) => { process.stderr.write(d); });

    // Wait for poller startup (15s sleep in poller.sh) + first poll cycle (10s interval)
    // to complete so the email cursor is set before we send the test email.
    log('Waiting 30s for poller startup + first poll cycle...');
    sleep(30_000);

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
  },
});

export default class PollerProvider {
  id() { return 'poller'; }

  async callApi(prompt, context) {
    const idx = h.nextTest();
    const desc = context.test?.description || `Test ${idx}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    h.log(`--- ${idx}. ${desc} ---`);

    h.ensureSetup();

    // Test 1: Wait for poller notification to appear in transcript
    if (meta.waitForNotification) {
      const { msgs: notifMsgs } = h.waitForContent(/email|mail|inbox/i, 120_000);
      const notifBaseline = h.agentCount(notifMsgs);
      h.log(`Notification matched — agent count=${notifBaseline} total=${notifMsgs.length}`);
      h.log('Waiting for agent to finish processing notification...');
      h.waitForAgent(notifBaseline - 1, 120_000, 5_000);
      const finalMsgs = h.fetchMessages();
      h.log(`After wait — agent count=${h.agentCount(finalMsgs)} total=${finalMsgs.length}`);
      const text = h.transcript(finalMsgs);
      h.log(`Transcript:\n${text}`);
      h.log(`Notification test done (${elapsed(t)})`);
      return { output: text, metadata: { conversationId: h.conversationId } };
    }

    // Test 2+: Send prompt and wait for agent reply
    const { output } = h.sendAndWait(prompt, meta);
    h.log(`Done (${elapsed(t)})`);
    return { output, metadata: { conversationId: h.conversationId } };
  }
}
