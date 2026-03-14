// runtime/evals/memory.provider.mjs
// Provider that tests memory persistence across sessions.
//
// Two modes:
//   1. Store+recall — sends a "store" prompt in session A, waits, sends a
//      "recall" prompt in session B. Returns recall output + MEMORY.md contents.
//   2. Single-prompt — sends one prompt in a fresh session (same as prompt.provider).
//
// Memory files (MEMORY.md, USER.md) are reset to their templates before each
// test so results don't bleed between tests.
//
// ── Why --local? ──────────────────────────────────────────────────────
//
// In Docker/CI the agent runs through a persistent gateway. The gateway's
// bootstrap cache (a module-level Map in bootstrap-cache.ts, keyed by
// sessionKey) loads workspace files — including MEMORY.md — once and never
// re-reads them, even for brand-new sessions. The cache is only cleared on
// session rollover (stale previous session + no explicit --session-id), and
// SIGUSR1 in-process restart does NOT clear it (the Map survives because
// the process doesn't die).
//
// This means store+recall tests fail in gateway mode: the store phase
// writes facts to MEMORY.md on disk, but the recall session's system prompt
// still contains the stale pre-store content from the bootstrap cache.
//
// The --local flag forces embedded mode, where each CLI invocation reads
// MEMORY.md fresh from disk. This is the correct mode for cross-session
// memory evals. Production is unaffected because it uses a durable session
// (same sessionKey, same cache entry) — the cache bug only manifests when
// testing cross-session persistence, which is eval-specific.
//
// Upstream bug: https://github.com/openclaw/openclaw/issues/28594

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, cleanOutput } from '../lib/utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
const WORKSPACE_DIR = join(STATE_DIR, 'workspace');
const SESSIONS_DIR = join(STATE_DIR, 'agents', 'main', 'sessions');

// Templates from the repo — used to reset memory between tests.
const TEMPLATE_DIR = resolve(__dirname, '../../openclaw/workspace');
const MEMORY_TEMPLATE = readFileSync(join(TEMPLATE_DIR, 'MEMORY.md'), 'utf-8');
const USER_TEMPLATE = readFileSync(join(TEMPLATE_DIR, 'USER.md'), 'utf-8');

let testIndex = 0;

function log(msg) { _log('eval:memory', msg); }

// Wipe all session files so the next prompt starts with zero conversation
// history. Unlike clearSessionsOnce(), this runs every time it's called —
// memory evals need a hard boundary between store and recall.
function clearSessions() {
  if (!runtime.needsSessionClear) return;
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      try { unlinkSync(join(SESSIONS_DIR, f)); } catch {}
    }
    log('Cleared sessions');
  } catch {
    log(`No sessions dir at ${SESSIONS_DIR} (ok for Docker)`);
  }
}

function resetMemory() {
  if (!existsSync(WORKSPACE_DIR)) mkdirSync(WORKSPACE_DIR, { recursive: true });

  writeFileSync(join(WORKSPACE_DIR, 'MEMORY.md'), MEMORY_TEMPLATE);
  writeFileSync(join(WORKSPACE_DIR, 'USER.md'), USER_TEMPLATE);

  // Clear daily logs if they exist
  const memoryDir = join(WORKSPACE_DIR, 'memory');
  if (existsSync(memoryDir)) {
    try {
      for (const f of readdirSync(memoryDir)) {
        if (f.endsWith('.md')) {
          try { unlinkSync(join(memoryDir, f)); } catch {}
        }
      }
      log('Cleared daily memory logs');
    } catch {}
  }

  // Also clear sessions so no conversation history carries over
  clearSessions();

  log('Reset workspace (MEMORY.md + USER.md + sessions)');
}

function runPrompt(prompt, sessionId, timeoutMs = 60_000) {
  const start = Date.now();
  try {
    // --local forces embedded mode so each invocation reads MEMORY.md fresh
    // from disk, bypassing the gateway's stale bootstrap cache (#28594).
    const raw = execFileSync(runtime.bin, [...runtime.args(prompt, sessionId), '--local'], {
      encoding: 'utf-8', timeout: timeoutMs,
    }).trim();

    const output = cleanOutput(raw);
    return { output, durationMs: Date.now() - start, error: null };
  } catch (err) {
    return { output: '', durationMs: Date.now() - start, error: err.message };
  }
}

function readMemoryFile() {
  const path = join(WORKSPACE_DIR, 'MEMORY.md');
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

export default class MemoryProvider {
  id() { return 'openclaw-memory'; }

  async callApi(prompt, context) {
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const meta = context.test?.metadata || {};
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);

    // Reset memory + sessions to template before each test.
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

      // 1b. Diagnostic: check if store phase wrote to MEMORY.md
      const postStore = readMemoryFile();
      const postStoreLines = postStore.split('\n').filter(l => {
        const t = l.trim();
        return t && t !== '---' && !t.startsWith('#') && !/^_.*_$/.test(t) && !/^title:|^summary:/.test(t);
      });
      log(`Post-store MEMORY.md: ${postStoreLines.length} substantive line(s)${postStoreLines.length > 0 ? ` — first: "${postStoreLines[0].trim().slice(0, 80)}"` : ' (empty — agent did NOT write)'}`);

      // 2. Clear sessions so recall has ZERO conversation history.
      //    The agent:main:main session key is shared across --session-id values,
      //    so without this the recall would just read the store prompt from history.
      clearSessions();

      // 3. Recall phase — fresh session, only MEMORY.md persists
      log(`Recall (session: ${recallSession}): "${prompt.slice(0, 80)}"`);
      const recall = runPrompt(prompt, recallSession, 60_000);

      if (recall.error) {
        log(`Recall error (${elapsed(t)}): ${recall.error}`);
      } else {
        log(`Recall reply (${elapsed(t)}): "${recall.output.slice(0, 100)}"`);
      }

      // 4. Read MEMORY.md contents for assertion use
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
