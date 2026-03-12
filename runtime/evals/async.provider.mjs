// runtime/evals/async.provider.mjs
// Provider that tests the agent doesn't block on complex tasks.
// Spawns a heavy prompt in the background, waits, then sends a simple prompt
// and measures response time.

import { execFileSync, spawn } from 'child_process';
import { elapsed, log as _log } from './utils.mjs';

const ENTRY = process.env.OPENCLAW_ENTRY || 'openclaw';
let testIndex = 0;

function log(msg) { _log('eval:async', msg); }

export default class AsyncProvider {
  id() { return 'openclaw-async'; }

  async callApi(prompt, context) {
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    const bgPrompt = meta.backgroundPrompt;
    const delay = (meta.delay || 5) * 1000;
    const maxResponseTime = (meta.maxResponseTime || 15) * 1000;

    if (!bgPrompt) {
      return { output: '', error: 'metadata.backgroundPrompt is required' };
    }

    // 1. Spawn complex task in background
    const bgSession = `eval-async-bg-${Date.now()}`;
    log(`Spawning background task: "${bgPrompt.slice(0, 60)}..."`);
    const bg = spawn(ENTRY, [
      'agent', '-m', bgPrompt, '--agent', 'main', '--session-id', bgSession,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    // 2. Wait for the background task to start processing
    log(`Waiting ${delay / 1000}s for background task to engage...`);
    await new Promise((resolve) => setTimeout(resolve, delay));

    // 3. Send simple prompt in a new session and measure response time
    const fgSession = `eval-async-fg-${Date.now()}`;
    log(`Sending foreground prompt: "${prompt}"`);
    const fgStart = Date.now();

    let output = '';
    try {
      const raw = execFileSync(ENTRY, [
        'agent', '-m', prompt, '--agent', 'main', '--session-id', fgSession,
      ], { encoding: 'utf-8', timeout: 60_000 }).trim();

      output = raw.split('\n')
        .filter((l) => !l.match(/^\d{2}:\d{2}:\d{2} \[/))
        .join('\n')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .trim();
    } catch (err) {
      log(`Foreground error (${elapsed(fgStart)}): ${err.message}`);
      try { bg.kill(); } catch {}
      return { output: '', error: err.message };
    }

    const responseTimeMs = Date.now() - fgStart;
    log(`Foreground replied (${elapsed(fgStart)}): ${output.slice(0, 80)}`);
    log(`Response time: ${responseTimeMs}ms (threshold: ${maxResponseTime}ms)`);

    // 4. Clean up background process
    try { bg.kill(); } catch {}

    return {
      output,
      metadata: { responseTimeMs, maxResponseTime },
    };
  }
}
