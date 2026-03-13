// runtime/evals/utils.mjs
// Shared utilities for eval providers and assertions.

import { existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
let _sessionsCleared = false;

export function resolveConvos() {
  const candidates = [
    '/app/node_modules/.bin/convos',                        // Docker container
    resolve(__dirname, '../../../node_modules/.bin/convos'), // local (runtime/)
  ];
  if (process.env.EVAL_RUNTIME === 'hermes') {
    candidates.unshift(resolve(__dirname, '../../runtime-hermes/node_modules/.bin/convos'));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'convos';
}

export function sleep(ms) {
  const buf = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buf), 0, 0, ms);
}

export function elapsed(start) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

export function log(prefix, msg) {
  console.log(`[${prefix}] ${msg}`);
}

// Wipe agent session files once per eval run so the agent starts fresh.
// The session key `agent:main:main` maps to the same file regardless of
// --session-id, so previous eval runs bleed into new ones without this.
export function clearSessionsOnce(agentId = 'main') {
  if (_sessionsCleared) return;
  if (process.env.EVAL_RUNTIME === 'hermes') {
    log('eval', 'Hermes: skipping session clear (each -q call is fresh)');
    _sessionsCleared = true;
    return;
  }
  const sessionsDir = join(STATE_DIR, 'agents', agentId, 'sessions');
  try {
    for (const f of readdirSync(sessionsDir)) {
      try { unlinkSync(join(sessionsDir, f)); } catch {}
    }
    log('eval', `Cleared sessions in ${sessionsDir}`);
  } catch {
    log('eval', `No sessions dir at ${sessionsDir} (ok for Docker)`);
  }
  _sessionsCleared = true;
}
