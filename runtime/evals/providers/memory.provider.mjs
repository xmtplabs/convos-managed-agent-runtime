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
// ── Gateway reload (SIGUSR1) ──────────────────────────────────────────
//
// In Docker/CI the agent runs through a persistent gateway. The gateway has
// a bootstrap cache (Map keyed by sessionKey) that loads workspace files
// — including MEMORY.md — once and never re-reads them, even for brand-new
// sessions. This means:
//
//   1. The store phase writes facts to MEMORY.md on disk.
//   2. A new recall session still gets the OLD MEMORY.md baked into its
//      system prompt, because the bootstrap cache returns the stale snapshot.
//   3. The memory_search vector index is also stale — it was built from the
//      template at gateway startup and never re-indexed after the write.
//
// Both paths to recall (system prompt + memory_search) fail, so the agent
// cannot find the stored facts.
//
// Workaround: send SIGUSR1 to the openclaw-gateway binary. This triggers an
// in-process restart (OPENCLAW_NO_RESPAWN=1 in gateway.sh) that clears all
// in-memory caches — bootstrap cache, system prompt memoization, and the
// memory search index — without killing the process or exiting the restart
// loop. The next session then reads fresh workspace files from disk.
//
// We reload twice per store+recall test:
//   - After resetMemory(): so the store phase sees the clean template
//   - After the store phase: so the recall phase sees the updated MEMORY.md
//
// Locally (no gateway), reloadGateway() is a no-op — each `openclaw agent`
// invocation runs in embedded mode and reads MEMORY.md fresh from disk.
//
// Upstream bug: https://github.com/openclaw/openclaw/issues/28594
// Remove this workaround when the bootstrap cache gets mtime-based
// invalidation.

import { execFileSync, execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { runtime } from '../lib/runtime.mjs';
import { elapsed, log as _log, cleanOutput, sleep } from '../lib/utils.mjs';

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

// Send SIGUSR1 to the gateway binary to trigger an in-process restart.
// This clears the bootstrap cache so the next session reads fresh workspace
// files. No-op when no gateway is running (local/embedded mode).
// See: https://github.com/openclaw/openclaw/issues/28594
function reloadGateway() {
  try {
    // Find the gateway binary PID (not the shell wrapper)
    const pid = execSync(
      'ps -eo pid,comm | grep "openclaw-gate" | awk \'{print $1}\' | head -1',
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    if (!pid) {
      log('No gateway process found — skip reload (embedded mode)');
      return;
    }
    process.kill(Number(pid), 'SIGUSR1');
    log(`Sent SIGUSR1 to gateway (PID ${pid}) — waiting for reload`);

    // Give the gateway time to complete its in-process restart
    sleep(5000);

    // Verify it's still healthy
    try {
      execSync(
        `curl -sf -o /dev/null --max-time 3 http://localhost:${runtime.defaultPort || 18789}/__openclaw__/canvas/`,
        { timeout: 8000 },
      );
      log('Gateway reloaded and healthy');
    } catch {
      log('WARNING: Gateway health check failed after reload');
    }
  } catch (err) {
    log(`Gateway reload skipped: ${err.message}`);
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
    const raw = execFileSync(runtime.bin, runtime.args(prompt, sessionId), {
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

    // Reset memory + sessions to template before each test, then reload the
    // gateway so the store phase starts with a clean bootstrap cache.
    resetMemory();
    reloadGateway();

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

      // 3. Reload the gateway so its bootstrap cache picks up the updated
      //    MEMORY.md. Without this, the recall session's system prompt would
      //    contain the stale pre-store MEMORY.md (openclaw/openclaw#28594).
      reloadGateway();

      // 4. Recall phase — fresh session, only MEMORY.md persists
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
