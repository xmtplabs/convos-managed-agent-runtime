// runtime/evals/utils.mjs
// Shared utilities for eval providers and assertions.

import { execFileSync, spawn as spawnProc } from 'child_process';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { runtime } from './runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
let _sessionsCleared = false;

/** Walk up from *start* to find the nearest directory containing *marker*. */
function findAncestor(start, marker) {
  let dir = resolve(start);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const RUNTIME_ROOT = findAncestor(__dirname, 'convos-platform') || resolve(__dirname, '../..');

export function resolveConvos() {
  const candidates = [
    '/app/node_modules/.bin/convos',                          // Docker container
    resolve(RUNTIME_ROOT, runtime.convosPath),                // runtime-specific local path
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

// Wipe agent session files and custom skills once per eval run so the agent
// starts fresh. Without this, skills created by previous runs cause the agent
// to say "already set up" instead of creating the skill from scratch.
export function clearSessionsOnce(agentId = 'main') {
  if (_sessionsCleared) return;
  if (!runtime.needsSessionClear) {
    log('eval', `${runtime.name}: skipping session clear (not needed)`);
  } else {
    const sessionsDir = join(STATE_DIR, 'agents', agentId, 'sessions');
    try {
      for (const f of readdirSync(sessionsDir)) {
        try { unlinkSync(join(sessionsDir, f)); } catch {}
      }
      log('eval', `Cleared sessions in ${sessionsDir}`);
    } catch {
      log('eval', `No sessions dir at ${sessionsDir} (ok for Docker)`);
    }
  }
  if (runtime.cleanEvalState) {
    runtime.cleanEvalState();
    log('eval', `Cleaned eval state (custom skills, agent cron jobs)`);
  }
  _sessionsCleared = true;
}

// ---------------------------------------------------------------------------
// queryAgent — unified CLI-vs-HTTP query used by prompt, memory, and async
// providers. Returns { output, durationMs, error }.
//
// OpenClaw: one-shot CLI call via adapter's bin/args.
// Hermes:   curls the /agent/query HTTP endpoint.
//
// opts.extraArgs — appended to CLI args (e.g. memory's --local flag).
// opts.timeout   — per-call timeout in ms (default 60s).
// ---------------------------------------------------------------------------

const _queryUrl = runtime.queryUrl || null;
const _gatewayToken = process.env.GATEWAY_TOKEN || '';

export function queryAgent(prompt, sessionId, opts = {}) {
  const timeoutMs = opts.timeout || 60_000;
  const start = Date.now();
  try {
    let raw;
    if (_queryUrl) {
      raw = execFileSync('curl', [
        '-sf',
        '-X', 'POST', `${_queryUrl}/agent/query`,
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${_gatewayToken}`,
        '-d', JSON.stringify({ query: prompt, session: sessionId }),
      ], { encoding: 'utf-8', timeout: timeoutMs }).trim();
    } else {
      const args = [
        ...runtime.args(prompt, sessionId),
        ...(opts.extraArgs || []),
      ];
      raw = execFileSync(runtime.bin, args, {
        encoding: 'utf-8', timeout: timeoutMs,
        ...(runtime.env ? { env: runtime.env } : {}),
        ...(runtime.cwd ? { cwd: runtime.cwd } : {}),
      }).trim();
    }
    const output = cleanOutput(raw);
    return { output, durationMs: Date.now() - start, error: null };
  } catch (err) {
    return { output: '', durationMs: Date.now() - start, error: err.message };
  }
}

// Non-blocking version of queryAgent — fires the command and resolves when
// it finishes or the timeout expires. Used by the async provider.
export function queryAgentAsync(prompt, sessionId, opts = {}) {
  const timeoutMs = opts.timeout || 30_000;

  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let settled = false;

    let bin, args;
    if (_queryUrl) {
      bin = 'curl';
      args = [
        '-sf',
        '-X', 'POST', `${_queryUrl}/agent/query`,
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${_gatewayToken}`,
        '-d', JSON.stringify({ query: prompt, session: sessionId }),
      ];
    } else {
      bin = runtime.bin;
      args = [...runtime.args(prompt, sessionId), ...(opts.extraArgs || [])];
    }

    const useRuntimeEnv = bin !== 'curl';
    const proc = spawnProc(bin, args, {
      ...(useRuntimeEnv && runtime.env ? { env: runtime.env } : {}),
      ...(useRuntimeEnv && runtime.cwd ? { cwd: runtime.cwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { process.stderr.write(d); });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        resolve({ output: cleanOutput(stdout.trim()), durationMs: Date.now() - start, error: null });
      }
    }, timeoutMs);

    proc.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const err = code !== 0 ? `Process exited with code ${code}` : null;
        resolve({ output: cleanOutput(stdout.trim()), durationMs: Date.now() - start, error: err });
      }
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ output: '', durationMs: Date.now() - start, error: err.message });
      }
    });
  });
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
