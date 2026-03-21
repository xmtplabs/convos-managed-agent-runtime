// runtime/evals/poller-hooks.provider.mjs
// E2E eval for poller hook auto-discovery:
//   plants a fake skill with poll.sh → poller picks it up → notification in XMTP.
// Also tests that the agent knows to create polling skills (not modify HEARTBEAT.md).

import { execSync, spawn } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { createHarness, resolveSkillsRoot, resolvePollerScript } from '../lib/convos-harness.mjs';
import { sleep, elapsed } from '../lib/utils.mjs';

const REAL_SKILLS_ROOT = resolveSkillsRoot();
const POLLER_SCRIPT = resolvePollerScript();

let pollerProc = null;
let tempSkillsRoot = null;

const h = createHarness('poller-hooks', {
  conversationPrefix: 'Poller Hooks Eval',
  cleanup() {
    if (pollerProc) { try { pollerProc.kill('SIGKILL'); } catch {} pollerProc = null; }
  },
  afterSetup({ sharedConversationId, EVAL_HOME, log }) {
    // Extra wait for gateway
    sleep(3_000);

    // Copy real skills into temp dir so we can add a test skill
    tempSkillsRoot = join(EVAL_HOME, 'skills');
    log('Copying skills to temp dir...');
    execSync(`cp -R "${REAL_SKILLS_ROOT}" "${tempSkillsRoot}"`, { encoding: 'utf-8' });

    // Plant the test skill with a poll.sh that emits a notification
    log('Planting test skill with poll.sh...');
    const testSkillDir = join(tempSkillsRoot, 'eval-rss-tracker');
    mkdirSync(testSkillDir, { recursive: true });
    writeFileSync(join(testSkillDir, 'SKILL.md'), [
      '---',
      'name: eval-rss-tracker',
      'description: |',
      '  Test skill for poller hooks eval. Emits a fake RSS notification.',
      '---',
      '',
      '# Eval RSS Tracker',
      '',
      'Test skill — poll.sh prints a fake notification each cycle.',
    ].join('\n'));
    writeFileSync(join(testSkillDir, 'poll.sh'), [
      '#!/bin/sh',
      'FLAG="/tmp/.eval-rss-tracker-fired"',
      'if [ ! -f "$FLAG" ]; then',
      '  echo "New post on Eval Feed: \\"Testing poller hooks\\" by eval-bot"',
      '  touch "$FLAG"',
      'fi',
    ].join('\n'));

    // Clean up the flag file from any previous run
    try { rmSync('/tmp/.eval-rss-tracker-fired', { force: true }); } catch {}

    // Start the poller with our temp skills root
    log('Starting poller with test skills...');
    pollerProc = spawn('sh', [POLLER_SCRIPT], {
      env: {
        ...process.env,
        HOME: EVAL_HOME,
        PORT: String(h.gatewayPort),
        POLL_INTERVAL_SECONDS: '10',
        SKILLS_ROOT: tempSkillsRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pollerProc.stdout.on('data', (d) => { process.stdout.write(d); });
    pollerProc.stderr.on('data', (d) => { process.stderr.write(d); });

    // Wait for poller startup (15s sleep in poller.sh) + first poll cycle (10s interval)
    // to ensure the custom poll.sh has been discovered and run at least once.
    log('Waiting 30s for poller startup + first poll cycle...');
    sleep(30_000);
  },
});

export default class PollerHooksProvider {
  id() { return 'poller-hooks'; }

  async callApi(prompt, context) {
    const idx = h.nextTest();
    const desc = context.test?.description || `Test ${idx}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    h.log(`--- ${idx}. ${desc} ---`);

    h.ensureSetup();

    // Test 1: Wait for the custom poll.sh notification to appear
    if (meta.waitForNotification) {
      const { msgs: notifMsgs } = h.waitForContent(/eval feed|new post/i, 120_000);
      const text = h.transcript(notifMsgs);
      h.log(`Transcript:\n${text}`);
      h.log(`Hook discovery test done (${elapsed(t)})`);
      return { output: text, metadata: { conversationId: h.conversationId } };
    }

    // Test 2+: Send prompt and wait for agent reply
    const { output } = h.sendAndWait(prompt, meta);
    h.log(`Done (${elapsed(t)})`);
    return { output, metadata: { conversationId: h.conversationId } };
  }
}
