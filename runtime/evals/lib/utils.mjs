// runtime/evals/utils.mjs
// Shared utilities for eval providers and assertions.

import { existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { runtime } from './runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
let _sessionsCleared = false;

export function resolveConvos() {
  const candidates = [
    '/app/node_modules/.bin/convos',                          // Docker container
    resolve(__dirname, runtime.convosPath),                    // runtime-specific local path
  ];
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
  if (!runtime.needsSessionClear) {
    log('eval', `${runtime.name}: skipping session clear (not needed)`);
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

// Strip runtime-specific noise from CLI output.
// Removes ANSI escape codes, openclaw timestamp lines, and any
// runtime-specific lines via the adapter's filterLines().
export function cleanOutput(raw) {
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  // Handle \r (carriage return) — CLI spinners overwrite the same line
  // using \r. Keep only the last segment per line (what a terminal shows).
  const resolveCarriageReturns = (s) => {
    return s.split('\n').map((line) => {
      if (!line.includes('\r')) return line;
      const segments = line.split('\r').filter(Boolean);
      return segments.length > 0 ? segments[segments.length - 1] : '';
    }).join('\n');
  };
  const resolved = resolveCarriageReturns(raw);
  const lines = resolved.split('\n')
    .map(stripAnsi)
    .filter((l) => !l.match(/^\d{2}:\d{2}:\d{2} \[/));
  return runtime.filterLines(lines)
    .join('\n')
    .trim();
}
