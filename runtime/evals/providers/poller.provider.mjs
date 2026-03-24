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
        DISABLE_POLLER: '0',
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

    // Test 1: Wait for poller notification to appear in transcript.
    // The agent sometimes proactively announces the email, sometimes stays
    // silent (the system prompt includes "Does this even need a reply?").
    // If no proactive announcement within 60s, nudge the agent so we still
    // verify the full pipeline: poller → notify → agent awareness.
    if (meta.waitForNotification) {
      const preMsgs = h.fetchMessages();
      const welcomeEnd = preMsgs.length;
      h.log(`Baseline before notification wait: ${h.agentCount(preMsgs)} agent msgs, ${welcomeEnd} total`);

      // Shorter timeout — if the agent will announce, it happens quickly.
      const { matched } = h.waitForContent(/email|mail|inbox/i, 60_000);

      if (matched) {
        h.log('Proactive announcement detected — waiting for agent to settle...');
        const cur = h.fetchMessages();
        h.waitForAgent(h.agentCount(cur) - 1, 60_000, 5_000);
      } else {
        // Nudge: the notification is in the agent's session history even if it
        // didn't announce. Ask specifically about emails so the agent checks.
        // If the nudge also gets no response (agent stuck), fall back to the
        // direct email question — gives the agent a second chance and a more
        // concrete prompt.
        h.log('No proactive announcement — nudging agent...');
        const nudge = h.sendAndWait('Did any emails or notifications come in? Check your inbox.', {});
        const nudgeGotReply = h.agentCount(h.fetchMessages()) > h.agentCount(preMsgs);
        if (!nudgeGotReply) {
          h.log('Nudge got no response — trying direct email question...');
          h.sendAndWait('What did the last email say? Who sent it?', {});
        }
      }

      const finalMsgs = h.fetchMessages();
      h.log(`After wait — agent count=${h.agentCount(finalMsgs)} total=${finalMsgs.length}`);
      const text = h.transcript(finalMsgs, welcomeEnd);
      h.log(`Transcript (post-welcome):\n${text || '(empty — agent did not respond to notification)'}`);
      h.log(`Notification test done (${elapsed(t)})`);
      return { output: text, metadata: { conversationId: h.conversationId } };
    }

    // Test 2+: Send prompt and wait for agent reply
    const { output } = h.sendAndWait(prompt, meta);
    h.log(`Done (${elapsed(t)})`);
    return { output, metadata: { conversationId: h.conversationId } };
  }
}
