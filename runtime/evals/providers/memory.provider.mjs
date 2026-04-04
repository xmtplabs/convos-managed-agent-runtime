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
// ── Why extraArgs? ─────────────────────────────────────────────────────
//
// OpenClaw uses --local to force embedded mode so each CLI invocation reads
// MEMORY.md fresh from disk, bypassing the gateway's stale bootstrap cache.
// Hermes doesn't need this. Each adapter sets memory.extraArgs accordingly.

import { execFileSync } from 'child_process';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, queryAgent } from '../lib/utils.mjs';

let testIndex = 0;

function log(msg) { _log('eval:memory', msg); }

const queryUrl = runtime.queryUrl || null;
const gatewayToken = process.env.GATEWAY_TOKEN || '';
const extraArgs = runtime.memory.extraArgs ?? [];

function resetMemory() {
  runtime.memory.reset();
  log('Reset memory state');
}

function clearSessions() {
  runtime.memory.clearSessions();
  if (queryUrl) {
    try {
      execFileSync('curl', [
        '-sf', '-X', 'POST',
        `${queryUrl}/agent/reset-history`,
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${gatewayToken}`,
      ], { encoding: 'utf-8', timeout: 5_000 });
    } catch {}
  }
}

function readMemoryFile() {
  return runtime.memory.read();
}

function query(prompt, sessionId, timeoutMs = 60_000) {
  return queryAgent(prompt, sessionId, { timeout: timeoutMs, extraArgs });
}

export default class MemoryProvider {
  id() { return 'memory'; }

  async callApi(prompt, context) {
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    resetMemory();

    if (meta.storePrompt) {
      const storeSession = `eval-memory-store-${Date.now()}-${testIndex}`;
      const recallSession = `eval-memory-recall-${Date.now()}-${testIndex}`;

      log(`Store (session: ${storeSession}): "${meta.storePrompt.slice(0, 80)}"`);
      const store = query(meta.storePrompt, storeSession);

      if (store.error) {
        log(`Store error (${elapsed(t)}): ${store.error}`);
      } else {
        log(`Store reply (${elapsed(t)}): "${store.output.slice(0, 100)}"`);
      }

      const postStore = readMemoryFile();
      const postStoreLines = postStore.split('\n').filter(l => {
        const t = l.trim();
        return t && t !== '---' && !t.startsWith('#') && !/^_.*_$/.test(t) && !/^title:|^summary:/.test(t);
      });
      log(`Post-store memory: ${postStoreLines.length} substantive line(s)${postStoreLines.length > 0 ? ` — first: "${postStoreLines[0].trim().slice(0, 80)}"` : ' (empty — agent did NOT write)'}`);

      clearSessions();

      log(`Recall (session: ${recallSession}): "${prompt.slice(0, 80)}"`);
      const recall = query(prompt, recallSession);

      if (recall.error) {
        log(`Recall error (${elapsed(t)}): ${recall.error}`);
      } else {
        log(`Recall reply (${elapsed(t)}): "${recall.output.slice(0, 100)}"`);
      }

      const memoryContents = readMemoryFile();

      return {
        output: recall.output || recall.error || '',
        metadata: {
          storeResponse: store.output,
          memoryContents,
        },
      };
    }

    const session = `eval-memory-${Date.now()}-${testIndex}`;
    log(`Sending: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

    const result = query(prompt, session);

    if (result.error) {
      log(`Error (${elapsed(t)}): ${result.error}`);
      return { output: '', error: result.error };
    }

    log(`Reply (${elapsed(t)}): "${result.output.slice(0, 120)}"`);
    return { output: result.output };
  }
}
