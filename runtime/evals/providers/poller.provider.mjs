// runtime/evals/poller.provider.mjs
// E2E eval for the poller pipeline:
//   pre-create RSS polling skill → poller discovers and runs poll.sh →
//   notification → agent sees it and responds.
//
// The skill is created as a fixture (not by the agent) to keep CI fast
// and deterministic. Test 1 verifies the agent knows poller mechanics.
// Test 2 verifies the full notification pipeline end-to-end.

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHarness, resolveSkillsRoot, resolvePollerScript } from '../lib/convos-harness.mjs';
import { sleep, elapsed, clearSessionsOnce } from '../lib/utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILLS_ROOT = resolveSkillsRoot();
const POLLER_SCRIPT = resolvePollerScript();

let pollerProc = null;

clearSessionsOnce();

/** Create a minimal RSS polling skill as a test fixture. */
function createRssSkillFixture() {
  const skillDir = join(SKILLS_ROOT, 'hn-tracker');
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(join(skillDir, 'SKILL.md'), `---
name: hn-tracker
description: Tracks Hacker News RSS feed for new posts.
---

# HN Tracker

Polls https://hnrss.org/newest?count=3 every 60s and notifies when new posts appear.
`);

  // poll.sh — fetches RSS, extracts titles, reports new ones
  writeFileSync(join(skillDir, 'poll.sh'), `#!/bin/sh
FEED_URL="https://hnrss.org/newest?count=3"
SEEN_FILE="/tmp/.hn-tracker-seen"
touch "$SEEN_FILE"

items=$(curl -sf "$FEED_URL" 2>/dev/null | grep -oP '(?<=<title>).*?(?=</title>)' | tail -n +2)
if [ -z "$items" ]; then exit 0; fi

echo "$items" | while IFS= read -r title; do
  if ! grep -qF "$title" "$SEEN_FILE" 2>/dev/null; then
    echo "[HN] New post: $title"
    echo "$title" >> "$SEEN_FILE"
  fi
done
`);

  return skillDir;
}

const h = createHarness('poller', {
  conversationPrefix: 'Poller Eval',
  cleanup() {
    if (pollerProc) { try { pollerProc.kill('SIGKILL'); } catch {} pollerProc = null; }
  },
  afterSetup({ log }) {
    // Create fixture skill and start poller during setup so both are ready
    // before any test runs. This eliminates timing issues.
    const skillDir = createRssSkillFixture();
    log(`[TESTING] Created RSS skill fixture at ${skillDir}`);

    log('[TESTING] Starting poller (10s interval)...');
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

    // Test 1 (knowledge): Ask agent about poller mechanics — no file creation needed.
    if (!meta.waitForNotification) {
      h.log(`[TESTING] Sending prompt: "${prompt.slice(0, 80)}..."`);
      const { output } = h.sendAndWait(prompt, meta);
      h.log(`Done (${elapsed(t)})`);
      return { output, metadata: { conversationId: h.conversationId } };
    }

    // Test 2 (e2e): Wait for poller to run the fixture skill and deliver a notification.
    const preMsgs = h.fetchMessages();
    const welcomeEnd = preMsgs.length;

    h.log('[TESTING] Waiting for poller to run poll.sh and deliver HN notification (up to 120s)...');
    const { matched } = h.waitForContent(/\[HN\]|hacker|new post|hnrss|feed/i, 120_000);

    if (matched) {
      h.log('Agent responded to poller notification — settling...');
      const cur = h.fetchMessages();
      h.waitForAgent(h.agentCount(cur) - 1, 30_000, 5_000);
    } else {
      h.log('No proactive announcement — nudging agent...');
      h.sendAndWait('Did any notifications come in about new Hacker News posts?', {});
    }

    const finalMsgs = h.fetchMessages();
    const text = h.transcript(finalMsgs, welcomeEnd);
    h.log(`Transcript (post-welcome):\n${text || '(empty)'}`);
    h.log(`Poller notification test done (${elapsed(t)})`);
    return { output: text, metadata: { conversationId: h.conversationId } };
  }
}
