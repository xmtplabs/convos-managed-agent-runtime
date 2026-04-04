// Runtime adapter for OpenClaw.

import { readFileSync, writeFileSync, readdirSync, unlinkSync, rmSync, existsSync, mkdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
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
const stateDir = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
const workspaceDir = join(stateDir, 'workspace');
const skillsDir = join(workspaceDir, 'skills');
const cronFile = join(stateDir, 'cron', 'jobs.json');
const sessionsDir = join(stateDir, 'agents', 'main', 'sessions');
const templateDir = join(RUNTIME_ROOT, 'openclaw', 'workspace');
const sharedSkillsDir = join(RUNTIME_ROOT, 'convos-platform', 'skills');

function clearDir(dir) {
  try {
    for (const f of readdirSync(dir)) {
      try { unlinkSync(join(dir, f)); } catch {}
    }
  } catch {}
}

// Remove agent-created skill directories, keeping only core skills from the
// shared template. Prevents previous eval runs from bleeding into new ones.
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
  name: 'openclaw',
  bin: process.env.OPENCLAW_ENTRY || 'openclaw',
  args: (prompt, session) => ['agent', '-m', prompt, '--agent', 'main', '--session-id', session],
  defaultPort: '18789',
  healthPath: '/__openclaw__/canvas/',
  restartPath: '/pool/restart',
  filterLines: (lines) => lines,
  needsSessionClear: true,
  convosPath: 'openclaw/node_modules/.bin/convos',
  cleanEvalState() {
    clearCustomSkills(skillsDir, sharedSkillsDir);
    clearAgentCronJobs(cronFile);
    // Remove generated skills (skill-builder output) so eval state doesn't bleed.
    const generatedDir = join(skillsDir, 'generated');
    if (existsSync(generatedDir)) {
      try { rmSync(generatedDir, { recursive: true, force: true }); } catch {}
    }
  },
  memory: {
    extraArgs: ['--local'],
    reset() {
      if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });
      writeFileSync(join(workspaceDir, 'MEMORY.md'), readFileSync(join(templateDir, 'MEMORY.md'), 'utf-8'));
      writeFileSync(join(workspaceDir, 'USER.md'), readFileSync(join(templateDir, 'USER.md'), 'utf-8'));
      const dailyDir = join(workspaceDir, 'memory');
      if (existsSync(dailyDir)) {
        for (const f of readdirSync(dailyDir)) {
          if (f.endsWith('.md')) try { unlinkSync(join(dailyDir, f)); } catch {}
        }
      }
      clearDir(sessionsDir);
      clearCustomSkills(skillsDir, sharedSkillsDir);
      clearAgentCronJobs(cronFile);
    },
    clearSessions() {
      clearDir(sessionsDir);
    },
    read() {
      try { return readFileSync(join(workspaceDir, 'MEMORY.md'), 'utf-8'); } catch { return ''; }
    },
  },
};
