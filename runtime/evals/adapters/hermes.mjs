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

import { readdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, statSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
const hermesDir = join(RUNTIME_ROOT, 'hermes');
const hermesHome = process.env.HERMES_HOME || join(hermesDir, '.hermes-dev', 'home');
const skillsDir = join(hermesHome, 'skills');
const cronFile = join(hermesHome, 'cron', 'jobs.json');
const cronOutputDir = join(hermesHome, 'cron', 'output');
const memoriesDir = join(hermesHome, 'memories');
const sessionsDir = join(hermesHome, 'sessions');
const stateDb = join(hermesHome, 'state.db');
const sharedSkillsDir = join(RUNTIME_ROOT, 'convos-platform', 'skills');

function clearDir(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)); } catch {}
  }
}

function clearCustomSkills(targetDir, templateRefDir) {
  if (!existsSync(targetDir) || !existsSync(templateRefDir)) return;
  const core = new Set(readdirSync(templateRefDir));
  for (const d of readdirSync(targetDir)) {
    if (!core.has(d) && statSync(join(targetDir, d)).isDirectory()) {
      try { rmSync(join(targetDir, d), { recursive: true, force: true }); } catch {}
    }
  }
}

// Remove agent-created cron jobs, keeping only seed jobs (id starts with "seed-").
function clearAgentCronJobs(jobsFile) {
  if (!existsSync(jobsFile)) return;
  try {
    const data = JSON.parse(readFileSync(jobsFile, 'utf-8'));
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    const seedOnly = jobs.filter((j) => j.id && j.id.startsWith('seed-'));
    if (seedOnly.length !== jobs.length) {
      writeFileSync(jobsFile, JSON.stringify({ ...data, jobs: seedOnly }, null, 2));
    }
  } catch {}
}

export default {
  name: 'hermes',
  defaultPort: '8080',
  healthPath: '/health',
  restartPath: '/pool/restart',
  filterLines: (lines) => lines.filter((l) => {
    if (l.match(/^session_id:\s/)) return false;
    if (l.match(/^\s*[\u2800-\u28FF]/)) return false;
    if (l.match(/\(\d+\.\d+s\)\s*$/)) return false;
    if (l.match(/^\s*┊/)) return false;
    return true;
  }),
  needsSessionClear: false,
  convosPath: 'hermes/node_modules/.bin/convos',
  // Providers use queryUrl to curl the production server's /agent/query endpoint.
  // No eval server, no process management — same path in CI and local dev.
  queryUrl: `http://127.0.0.1:${process.env.PORT || '8080'}`,
  cleanEvalState() {
    clearCustomSkills(skillsDir, sharedSkillsDir);
    clearAgentCronJobs(cronFile);
    clearDir(cronOutputDir);
    // Remove generated skills (skill-builder output) so eval state doesn't bleed.
    const generatedDir = join(skillsDir, 'generated');
    if (existsSync(generatedDir)) {
      try { rmSync(generatedDir, { recursive: true, force: true }); } catch {}
    }
  },
  memory: {
    extraArgs: [],
    reset() {
      clearDir(memoriesDir);
      clearDir(sessionsDir);
      clearCustomSkills(skillsDir, sharedSkillsDir);
      clearAgentCronJobs(cronFile);
      clearDir(cronOutputDir);
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
