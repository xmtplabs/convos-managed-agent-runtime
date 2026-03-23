// Runtime adapter for Hermes.
// Baseline adapter is openclaw.mjs — this file documents only what differs.
//
// ┌─────────────────────┬──────────────────────────┬──────────────────────────┐
// │ Concern             │ OpenClaw (baseline)       │ Hermes (this file)       │
// ├─────────────────────┼──────────────────────────┼──────────────────────────┤
// │ Query path          │ CLI (bin/args per test)   │ HTTP (queryUrl → :8080)  │
// │ Why                 │ Node.js — fast cold start │ Python — warm server     │
// │ Memory storage      │ MEMORY.md (single file)   │ memories/ dir (.md each) │
// │ Memory reset        │ Copy template files        │ Clear dir + state.db     │
// │ Session reset       │ Delete session files       │ Clear dir + POST /reset  │
// │ bin/args/env/cwd    │ Yes (CLI invocation)       │ Not used (HTTP only)     │
// └─────────────────────┴──────────────────────────┴──────────────────────────┘

import { readdirSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hermesDir = join(__dirname, '../../hermes');
const hermesHome = process.env.HERMES_HOME || join(hermesDir, '.hermes-dev', 'home');
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
  defaultPort: '8080',
  healthPath: '/pool/health',
  filterLines: (lines) => lines.filter((l) => {
    if (l.match(/^session_id:\s/)) return false;
    if (l.match(/^\s*[\u2800-\u28FF]/)) return false;
    if (l.match(/\(\d+\.\d+s\)\s*$/)) return false;
    if (l.match(/^\s*┊/)) return false;
    return true;
  }),
  needsSessionClear: false,
  convosPath: '../../hermes/node_modules/.bin/convos',
  // Providers use queryUrl to curl the production server's /agent/query endpoint.
  // No eval server, no process management — same path in CI and local dev.
  queryUrl: `http://127.0.0.1:${process.env.PORT || '8080'}`,
  memory: {
    extraArgs: [],
    reset() {
      clearDir(memoriesDir);
      clearDir(sessionsDir);
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
