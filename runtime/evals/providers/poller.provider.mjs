// runtime/evals/poller.provider.mjs
// E2E eval for the poller pipeline:
//   agent creates RSS polling skill → poller discovers and runs poll.sh → notification → agent responds.

import { spawn } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHarness, resolveSkillsRoot, resolvePollerScript } from '../lib/convos-harness.mjs';
import { sleep, elapsed, clearSessionsOnce } from '../lib/utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILLS_ROOT = resolveSkillsRoot();
const POLLER_SCRIPT = resolvePollerScript();

let pollerProc = null;

// Clean up custom skills and sessions from previous runs so the agent
// creates the RSS skill fresh instead of saying "already set up".
clearSessionsOnce();

const h = createHarness('poller', {
  conversationPrefix: 'Poller Eval',
  cleanup() {
    if (pollerProc) { try { pollerProc.kill('SIGKILL'); } catch {} pollerProc = null; }
  },
});

function startPoller() {
  h.log('Starting poller (10s interval)...');
  pollerProc = spawn('sh', [POLLER_SCRIPT], {
    env: {
      ...process.env,
      HOME: process.env.EVAL_CONVOS_HOME || process.env.HOME,
      PORT: String(
        process.env.POOL_SERVER_PORT ||
        process.env.PORT ||
        process.env.GATEWAY_INTERNAL_PORT ||
        '18789',
      ),
      POLL_INTERVAL_SECONDS: '10',
      DISABLE_POLLER: '0',
      SKILLS_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pollerProc.stdout.on('data', (d) => { process.stdout.write(d); });
  pollerProc.stderr.on('data', (d) => { process.stderr.write(d); });
}

export default class PollerProvider {
  id() { return 'poller'; }

  async callApi(prompt, context) {
    const idx = h.nextTest();
    const desc = context.test?.description || `Test ${idx}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    h.log(`--- ${idx}. ${desc} ---`);

    h.ensureSetup();

    // Test 1: Start the poller early (it has a 15s startup delay), then ask the
    // agent to create the RSS skill. By the time the skill files are written,
    // the poller is already running and discovers them on the next cycle.
    if (!meta.waitForNotification) {
      if (!pollerProc) {
        h.log('[TESTING] Pre-starting poller (15s startup delay runs in parallel with agent work)...');
        startPoller();
      }

      h.log(`[TESTING] Agent creates RSS poll.sh skill — prompt: "${prompt.slice(0, 80)}..."`);
      const { output } = h.sendAndWait(prompt, meta);
      h.log(`Done (${elapsed(t)})`);

      return { output, metadata: { conversationId: h.conversationId } };
    }

    // Test 2: Wait for poller to run the skill and deliver a notification.
    // The poller should already be running from test 1. Give it enough time
    // for the poll cycle to discover the new skill and run poll.sh.
    const preMsgs = h.fetchMessages();
    const welcomeEnd = preMsgs.length;

    h.log('[TESTING] Waiting for poller to run poll.sh and deliver RSS notification (up to 120s)...');
    const { matched } = h.waitForContent(/rss|feed|post|hacker|hnrss|new.*item/i, 120_000);

    if (matched) {
      h.log('Agent responded to poller notification — settling...');
      const cur = h.fetchMessages();
      h.waitForAgent(h.agentCount(cur) - 1, 30_000, 5_000);
    } else {
      h.log('No proactive announcement — nudging agent...');
      h.sendAndWait('Any updates from the RSS feed you set up? Did any new posts come in?', {});
    }

    const finalMsgs = h.fetchMessages();
    const text = h.transcript(finalMsgs, welcomeEnd);
    h.log(`Transcript (post-welcome):\n${text || '(empty)'}`);
    h.log(`Poller notification test done (${elapsed(t)})`);
    return { output: text, metadata: { conversationId: h.conversationId } };
  }
}
