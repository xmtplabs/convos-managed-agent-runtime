// runtime/evals/memory.provider.mjs
// Provider that tests memory persistence across sessions.
//
// Two modes:
//   1. Store+recall — sends a "store" prompt in session A, waits, sends a
//      "recall" prompt in session B. Returns recall output + memory contents.
//   2. Single-prompt — sends one prompt in a fresh session (same as prompt.provider).
//
// Memory is reset via the runtime adapter before each test so results don't
// bleed between tests.
//
// When the runtime has a gateway (hermes), starts a persistent eval server
// and routes queries via HTTP — the agent stays warm with cached context.
//
// ── Why extraArgs? ─────────────────────────────────────────────────────
//
// OpenClaw uses --local to force embedded mode so each CLI invocation reads
// MEMORY.md fresh from disk, bypassing the gateway's stale bootstrap cache.
// Hermes doesn't need this. Each adapter sets memory.extraArgs accordingly.

import { execFileSync } from 'child_process';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, cleanOutput, sleep } from '../lib/utils.mjs';

let testIndex = 0;

function log(msg) { _log('eval:memory', msg); }

const GATEWAY_PORT = process.env.EVAL_MEMORY_GATEWAY_PORT || '9092';
let useGateway = false;
let gatewayToken = '';

if (runtime.gateway) {
  log('Starting persistent eval server for memory tests...');
  runtime.gateway.start(GATEWAY_PORT);
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    sleep(1_000);
    try {
      execFileSync('curl', ['-sf', `http://127.0.0.1:${GATEWAY_PORT}${runtime.healthPath}`],
        { encoding: 'utf-8', timeout: 5_000 });
      ready = true;
      break;
    } catch {}
  }
  if (ready) {
    useGateway = true;
    gatewayToken = runtime.env?.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || '';
    log(`Eval server ready on port ${GATEWAY_PORT}.`);
  } else {
    log('Eval server failed to start — falling back to CLI.');
    runtime.gateway.stop();
  }

  function cleanup() { try { runtime.gateway.stop(); } catch {} }
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
}

function resetMemory() {
  runtime.memory.reset();
  log('Reset memory state');
}

function clearSessions() {
  runtime.memory.clearSessions();
  // Also reset the server-side conversation history if using gateway
  if (useGateway) {
    try {
      execFileSync('curl', [
        '-sf', '-X', 'POST',
        `http://127.0.0.1:${GATEWAY_PORT}/agent/reset-history`,
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${gatewayToken}`,
      ], { encoding: 'utf-8', timeout: 5_000 });
    } catch {}
  }
}

function readMemoryFile() {
  return runtime.memory.read();
}

function runPrompt(prompt, sessionId, timeoutMs = 60_000) {
  const start = Date.now();
  try {
    let raw;
    if (useGateway) {
      raw = execFileSync('curl', [
        '-sf',
        '-X', 'POST', `http://127.0.0.1:${GATEWAY_PORT}/agent/query`,
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${gatewayToken}`,
        '-d', JSON.stringify({ query: prompt, session: sessionId }),
      ], { encoding: 'utf-8', timeout: timeoutMs }).trim();
    } else {
      const args = [...runtime.args(prompt, sessionId), ...(runtime.memory.extraArgs ?? [])];
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

export default class MemoryProvider {
  id() { return 'memory'; }

  async callApi(prompt, context) {
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    // Reset memory + sessions before each test.
    resetMemory();

    if (meta.storePrompt) {
      // Store+recall mode: two sessions
      const storeSession = `eval-memory-store-${Date.now()}-${testIndex}`;
      const recallSession = `eval-memory-recall-${Date.now()}-${testIndex}`;

      // 1. Store phase
      log(`Store (session: ${storeSession}): "${meta.storePrompt.slice(0, 80)}"`);
      const store = runPrompt(meta.storePrompt, storeSession, 60_000);

      if (store.error) {
        log(`Store error (${elapsed(t)}): ${store.error}`);
      } else {
        log(`Store reply (${elapsed(t)}): "${store.output.slice(0, 100)}"`);
      }

      // 1b. Diagnostic: check if store phase wrote to memory
      const postStore = readMemoryFile();
      const postStoreLines = postStore.split('\n').filter(l => {
        const t = l.trim();
        return t && t !== '---' && !t.startsWith('#') && !/^_.*_$/.test(t) && !/^title:|^summary:/.test(t);
      });
      log(`Post-store memory: ${postStoreLines.length} substantive line(s)${postStoreLines.length > 0 ? ` — first: "${postStoreLines[0].trim().slice(0, 80)}"` : ' (empty — agent did NOT write)'}`);

      // 2. Clear sessions so recall has ZERO conversation history.
      clearSessions();

      // 3. Recall phase — fresh session, only memory persists
      log(`Recall (session: ${recallSession}): "${prompt.slice(0, 80)}"`);
      const recall = runPrompt(prompt, recallSession, 60_000);

      if (recall.error) {
        log(`Recall error (${elapsed(t)}): ${recall.error}`);
      } else {
        log(`Recall reply (${elapsed(t)}): "${recall.output.slice(0, 100)}"`);
      }

      // 4. Read memory contents for assertion use
      const memoryContents = readMemoryFile();

      return {
        output: recall.output || recall.error || '',
        metadata: {
          storeResponse: store.output,
          memoryContents,
        },
      };
    }

    // Single-prompt mode
    const session = `eval-memory-${Date.now()}-${testIndex}`;
    log(`Sending: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

    const result = runPrompt(prompt, session, 60_000);

    if (result.error) {
      log(`Error (${elapsed(t)}): ${result.error}`);
      return { output: '', error: result.error };
    }

    log(`Reply (${elapsed(t)}): "${result.output.slice(0, 120)}"`);
    return { output: result.output };
  }
}
