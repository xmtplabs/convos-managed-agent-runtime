// runtime/evals/prompt.provider.mjs
// Lightweight provider that prompts the agent directly via `openclaw agent -m`.
// Clears session history on first call so the agent starts fresh.

import { execFileSync } from 'child_process';
import { elapsed, log as _log, clearSessionsOnce } from './utils.mjs';

const ENTRY = process.env.OPENCLAW_ENTRY || 'openclaw';
let testIndex = 0;

function log(msg) { _log('eval:prompt', msg); }

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
