// runtime/evals/prompt.provider.mjs
// Lightweight provider that prompts the agent directly via `openclaw agent -m`.
// Clears session history on first call so the agent starts fresh.

import { execFileSync } from 'child_process';
import { readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { elapsed, log as _log } from './utils.mjs';

const ENTRY = process.env.OPENCLAW_ENTRY || 'openclaw';
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
let testIndex = 0;
let sessionsCleared = false;

function log(msg) { _log('eval:prompt', msg); }

// Wipe session files once per eval run so the agent has no memory of previous runs.
// The session key `agent:main:main` always maps to the same file regardless of --session-id.
function clearSessionsOnce() {
  if (sessionsCleared) return;
  const sessionsDir = join(STATE_DIR, 'agents', 'main', 'sessions');
  try {
    for (const f of readdirSync(sessionsDir)) {
      try { unlinkSync(join(sessionsDir, f)); } catch {}
    }
    log(`Cleared sessions in ${sessionsDir}`);
  } catch {
    log(`No sessions dir at ${sessionsDir} (ok for Docker)`);
  }
  sessionsCleared = true;
}

export default class PromptProvider {
  id() { return 'openclaw-prompt'; }

  async callApi(prompt, context) {
    clearSessionsOnce();
    testIndex++;
    const desc = context.test?.description || `Test ${testIndex}`;
    const session = `eval-prompt-${Date.now()}-${testIndex}`;
    const t = Date.now();
    log(`--- ${testIndex}. ${desc} ---`);
    log(`Sending: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

    try {
      const raw = execFileSync(ENTRY, [
        'agent', '-m', prompt, '--agent', 'main', '--session-id', session,
      ], { encoding: 'utf-8', timeout: 60_000 }).trim();

      // Strip diagnostic/log lines that openclaw dumps to stdout
      // and ANSI escape codes that break regex assertions
      const output = raw.split('\n')
        .filter((l) => !l.match(/^\d{2}:\d{2}:\d{2} \[/))
        .join('\n')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .trim();

      const preview = output.slice(0, 120);
      log(`Reply (${elapsed(t)}): ${preview}${output.length > 120 ? '...' : ''}`);
      return { output };
    } catch (err) {
      log(`Error (${elapsed(t)}): ${err.message}`);
      return { output: '', error: err.message };
    }
  }
}
