// Runtime adapter for Hermes.
// Hermes uses `hermes chat -q` for single-query mode.
// Each -q call auto-creates a fresh session (no --session-id flag).
// Quiet mode prints a `session_id:` footer that must be stripped.

import { readdirSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hermesDir = join(__dirname, '../../hermes');
const evalHome = join(hermesDir, '.eval-home');
const hermesHome = process.env.HERMES_HOME || join(evalHome, '.hermes');
const memoriesDir = join(hermesHome, 'memories');
const sessionsDir = join(hermesHome, 'sessions');
const stateDb = join(hermesHome, 'state.db');

function clearDir(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)); } catch {}
  }
}

export default {
  name: 'hermes',
  bin: 'hermes',
  args: (prompt, _session) => ['chat', '-q', prompt, '--quiet'],
  defaultPort: '8080',
  healthPath: '/pool/health',
  filterLines: (lines) => lines.filter((l) => {
    if (l.match(/^session_id:\s/)) return false;
    // Braille spinners (U+2800-U+28FF) from CLI progress display
    if (l.match(/^\s*[\u2800-\u28FF]/)) return false;
    // Kaomoji progress spinners — "◜ (°ロ°) formulating... (0.3s)" etc.
    if (l.match(/\(\d+\.\d+s\)\s*$/)) return false;
    // Tool call status lines — "┊ 🧠 memory    +user: ..."
    if (l.match(/^\s*┊/)) return false;
    return true;
  }),
  needsSessionClear: false,
  convosPath: '../../hermes/node_modules/.bin/convos',
  memory: {
    extraArgs: [],
    reset() {
      clearDir(memoriesDir);
      clearDir(sessionsDir);
      // SessionDB (state.db) powers session_search — must be cleared
      // between tests or previous conversations leak into recall.
      try { unlinkSync(stateDb); } catch {}
    },
    clearSessions() {
      clearDir(sessionsDir);
      try { unlinkSync(stateDb); } catch {}
    },
    read() {
      if (!existsSync(memoriesDir)) return '';
      const files = readdirSync(memoriesDir).filter(f => f.endsWith('.md')).sort();
      return files.map(f => readFileSync(join(memoriesDir, f), 'utf-8')).join('\n\n');
    },
  },
};
