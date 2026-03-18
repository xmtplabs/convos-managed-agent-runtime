# Runtime OpenClaw Restructure — Make Runtimes Peers

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move OpenClaw's files out of the `runtime/` root into `runtime/openclaw/` so both runtimes are peers, not host-and-tenant.

**Architecture:** Currently `runtime/` IS the OpenClaw runtime (package.json, Dockerfile, scripts/, .env all belong to it) with hermes as a self-contained subdirectory. After this change, both `runtime/openclaw/` and `runtime/hermes/` are independent, self-contained runtimes. The shared `runtime/evals/` and `runtime/.env` stay at the root as truly shared components.

**Tech Stack:** Shell scripts, Dockerfiles, GitHub Actions YAML, Node.js package.json

**Important:** All tasks MUST land in a single PR. Partial merges will break CI — the git moves, Dockerfile updates, workflow updates, and path fixes are one atomic change.

---

## Current vs Target Layout

```
CURRENT:                              TARGET:
runtime/                              runtime/
├── package.json      ← OC            ├── .env               ← shared (stays)
├── pnpm-lock.yaml    ← OC            ├── .env.example       ← shared (stays, updated)
├── Dockerfile        ← OC            ├── README.md          ← shared (stays, updated)
├── scripts/          ← OC            ├── evals/             ← shared (unchanged)
├── .env              ← OC            ├── openclaw/
├── .env.example      ← OC            │   ├── package.json   ← moved
├── .npmrc            ← OC            │   ├── pnpm-lock.yaml ← moved
├── CHANGELOG.md      ← OC            │   ├── Dockerfile     ← moved
├── README.md                         │   ├── scripts/       ← moved
├── evals/            ← shared        │   ├── .npmrc         ← moved
├── openclaw/         ← OC exts       │   ├── CHANGELOG.md   ← moved
│   ├── extensions/                   │   ├── extensions/    ← stays
│   ├── workspace/                    │   ├── workspace/     ← stays
│   └── openclaw.json                 │   └── openclaw.json  ← stays
└── hermes/           ← self-cont.    └── hermes/            ← loses .env/.env.example
    ├── .env          ← hermes
    └── .env.example  ← hermes
```

**Files moved** into `runtime/openclaw/`: `package.json`, `pnpm-lock.yaml`, `.npmrc`, `Dockerfile`, `CHANGELOG.md`, `scripts/`

**Files that stay** at `runtime/` root: `.env` (unified, shared), `.env.example` (merged), `README.md` (updated), `evals/` (shared)

**Files deleted**: `runtime/hermes/.env.example` (merged into root `.env.example`)

**Files NOT moved** (developer action): `runtime/hermes/.env` is gitignored — developer merges its contents into `runtime/.env` and deletes it

## Unified .env — Design Decision

Instead of maintaining separate `.env` files per runtime, use a single `runtime/.env` containing all env vars for both runtimes. This eliminates an entire class of path changes:

- `env.sh` already sources `$_ENV_RUNTIME_DIR/.env` = `runtime/.env` — **no change needed**
- `eval-env.sh` already sources `$REPO_ROOT/runtime/.env` — **no change needed**
- `convos.provider.mjs` error message already says `runtime/.env` — **no change needed**

The hermes-only vars (`PORT`, `HONCHO_API_KEY`) are harmless when set for openclaw (just ignored). Both runtimes share all other vars (`OPENROUTER_API_KEY`, `OPENCLAW_PRIMARY_MODEL`, `XMTP_ENV`, `POOL_URL`, `INSTANCE_ID`, `OPENCLAW_GATEWAY_TOKEN`, `CONVOS_API_KEY`).

## Key Design Decision: Docker/Local Eval Path Divergence

The package.json eval scripts face a split:
- **In Docker** (`/app/`): evals/ is a sibling of package.json → `sh evals/run-suite.sh` works
- **Locally** (`runtime/openclaw/`): evals/ is at `runtime/evals/` → needs `sh ../evals/run-suite.sh`

**Solution:** Use a directory check that works in both contexts:
```json
"evals:knows": "if [ -d evals ]; then sh evals/run-suite.sh knows.yaml; else sh ../evals/run-suite.sh knows.yaml; fi"
```

## Reference Map — Everything That Breaks

| File | What breaks | Fix |
|------|-------------|-----|
| `runtime/Dockerfile` (→ `openclaw/Dockerfile`) | `COPY runtime/package.json`, `COPY runtime/scripts` source paths | Update COPY source paths |
| `.github/workflows/runtime-pr.yml` | `file: runtime/Dockerfile`, version from `runtime/package.json`, path filters | Update all paths |
| `.github/workflows/runtime-dispatch.yml` | Same as above | Same |
| `.github/workflows/runtime-eval.yml` | `working-directory: runtime`, `pnpm` scripts | Change working-directory to `runtime/openclaw` |
| `runtime/evals/adapters/env.sh` | hermes case sources `$_ENV_HERMES_DIR/.env` (file eliminated) | Remove that line; `$_ENV_RUNTIME_DIR/.env` already covers it |
| `runtime/evals/adapters/openclaw.mjs` | `convosPath` relative to old node_modules | Update to `../../openclaw/node_modules/.bin/convos` |
| `runtime/hermes/scripts/eval-env.sh` | Sources `$RUNTIME_DIR/.env` (= `hermes/.env`, eliminated) | Remove redundant line; keep `$REPO_ROOT/runtime/.env` |
| `runtime/hermes/scripts/dev-run.sh` | Sources `$RUNTIME_DIR/.env` (= `hermes/.env`, eliminated) | Change to `$RUNTIME_DIR/../.env` |
| `runtime/hermes/scripts/dev-setup.sh` | Checks for `$RUNTIME_DIR/.env` | Change to `$RUNTIME_DIR/../.env` |
| `openclaw/package.json` (moved) | `cd .. && docker build`, eval script paths | Update relative paths + dual-path evals |
| `pool/frontend/upgrades.html` | GitHub URL to `runtime/CHANGELOG.md` | Update to `runtime/openclaw/CHANGELOG.md` |
| `openclaw/workspace/skills/convos-runtime/SKILL.md` | Raw GitHub URL to `runtime/CHANGELOG.md` | Update to `runtime/openclaw/CHANGELOG.md` |
| `runtime/README.md` | Path references everywhere | Rewrite paths |
| `runtime/evals/README.md` | Path references | Update |
| Root `AGENTS.md` | `cd runtime && pnpm build` | Update to `cd runtime/openclaw` |

### Things That Do NOT Break

- **`runtime/.env` sourcing in eval scripts** — `$_ENV_RUNTIME_DIR/.env` = `runtime/.env` stays exactly where it is
- **Pool start command** (`node scripts/pool-server.js` in railway.ts) — relative to container WORKDIR `/app/`, container layout unchanged
- **Hermes Dockerfile** — uses `runtime/hermes/...` paths, unchanged
- **Hermes CI workflows** — reference `runtime/hermes/...`, unchanged
- **Eval adapters' relative paths to runtime dirs** — `../../openclaw/workspace` and `../../hermes` from `evals/adapters/` still resolve correctly
- **Docker container layout** — COPY destinations stay the same, only COPY sources change
- **`.gitignore`** — uses global patterns (`.env`, `node_modules`) that work at any depth

---

## Task 1: Git-move OpenClaw files into `runtime/openclaw/`

**Files:**
- Move: `runtime/package.json` → `runtime/openclaw/package.json`
- Move: `runtime/pnpm-lock.yaml` → `runtime/openclaw/pnpm-lock.yaml`
- Move: `runtime/.npmrc` → `runtime/openclaw/.npmrc`
- Move: `runtime/Dockerfile` → `runtime/openclaw/Dockerfile`
- Move: `runtime/CHANGELOG.md` → `runtime/openclaw/CHANGELOG.md`
- Move: `runtime/scripts/` → `runtime/openclaw/scripts/`
- Keep: `runtime/.env` (stays at root — shared by both runtimes)
- Keep: `runtime/.env.example` (stays at root — will be updated in Task 4)

- [ ] **Step 1: Move files with git mv**

```bash
cd /path/to/convos-agents/runtime

git mv package.json openclaw/package.json
git mv pnpm-lock.yaml openclaw/pnpm-lock.yaml
git mv .npmrc openclaw/.npmrc
git mv Dockerfile openclaw/Dockerfile
git mv CHANGELOG.md openclaw/CHANGELOG.md
git mv scripts/ openclaw/scripts/
```

- [ ] **Step 2: Verify the move**

```bash
ls runtime/openclaw/package.json runtime/openclaw/Dockerfile runtime/openclaw/scripts/gateway.sh
# All should exist

ls runtime/package.json runtime/Dockerfile runtime/scripts/ 2>&1
# All should say "No such file or directory"

ls runtime/.env.example runtime/evals/run-suite.sh
# Both should still exist at root
```

- [ ] **Step 3: Commit the move**

```bash
git add -A runtime/
git commit -m "refactor(runtime): move openclaw files into runtime/openclaw/"
```

---

## Task 2: Update Dockerfile COPY paths

**Files:**
- Modify: `runtime/openclaw/Dockerfile`

The Dockerfile builds with context `.` (repo root). COPY source paths for OpenClaw files change from `runtime/` to `runtime/openclaw/`. The evals COPY stays unchanged.

- [ ] **Step 1: Update COPY instructions**

```dockerfile
# BEFORE:
COPY runtime/package.json runtime/pnpm-lock.yaml /app/
COPY runtime/openclaw/openclaw.json /app/openclaw/openclaw.json
COPY runtime/openclaw/workspace /app/openclaw/workspace
COPY runtime/openclaw/extensions /app/openclaw/extensions
COPY runtime/scripts ./scripts
COPY runtime/evals ./evals

# AFTER:
COPY runtime/openclaw/package.json runtime/openclaw/pnpm-lock.yaml /app/
COPY runtime/openclaw/openclaw.json /app/openclaw/openclaw.json
COPY runtime/openclaw/workspace /app/openclaw/workspace
COPY runtime/openclaw/extensions /app/openclaw/extensions
COPY runtime/openclaw/scripts ./scripts
COPY runtime/evals ./evals
```

Container layout (`/app/scripts/`, `/app/openclaw/`, `/app/evals/`) is identical to before.

- [ ] **Step 2: Verify Docker build**

```bash
cd /path/to/convos-agents
docker build -f runtime/openclaw/Dockerfile -t convos-runtime:test .
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add runtime/openclaw/Dockerfile
git commit -m "fix(runtime): update Dockerfile COPY paths after restructure"
```

---

## Task 3: Update openclaw package.json scripts

**Files:**
- Modify: `runtime/openclaw/package.json`

Two kinds of path changes:
1. **Docker build commands** that did `cd ..` now need `cd ../..` (one level deeper)
2. **Eval scripts** need dual-path detection (Docker: `evals/` sibling, Local: `../evals/` parent)
3. **Docker `--env-file`** paths now reference `runtime/.env` (root, not openclaw)

Runtime scripts (`start`, `gateway`, `keys`, etc.) use relative `scripts/` paths and don't change — scripts/ moved alongside package.json.

- [ ] **Step 1: Update all script paths**

```json
{
  "scripts": {
    "start": "sh scripts/keys.sh && sh scripts/apply-config.sh && sh scripts/install-deps.sh && sh scripts/identity.sh && sh scripts/gateway.sh",
    "keys": "sh scripts/keys.sh",
    "apply": "sh scripts/apply-config.sh",
    "install-deps": "sh scripts/install-deps.sh",
    "gateway": "sh scripts/gateway.sh",
    "clean-sessions": "sh scripts/clean-sessions.sh",
    "smoke": "sh scripts/smoke.sh",
    "evals": "if [ -d evals ]; then sh evals/run.sh; else sh ../evals/run.sh; fi",
    "evals:knows": "if [ -d evals ]; then sh evals/run-suite.sh knows.yaml; else sh ../evals/run-suite.sh knows.yaml; fi",
    "evals:skills": "if [ -d evals ]; then sh evals/run-suite.sh skills.yaml; else sh ../evals/run-suite.sh skills.yaml; fi",
    "evals:soul": "if [ -d evals ]; then sh evals/run-suite.sh soul.yaml; else sh ../evals/run-suite.sh soul.yaml; fi",
    "evals:convos": "if [ -d evals ]; then sh evals/run-suite.sh convos.yaml; else sh ../evals/run-suite.sh convos.yaml; fi",
    "evals:async": "if [ -d evals ]; then sh evals/run-suite.sh async.yaml; else sh ../evals/run-suite.sh async.yaml; fi",
    "evals:memory": "if [ -d evals ]; then sh evals/run-suite.sh memory.yaml; else sh ../evals/run-suite.sh memory.yaml; fi",
    "evals:hermes": "if [ -d evals ]; then EVAL_RUNTIME=hermes sh evals/run.sh; else EVAL_RUNTIME=hermes sh ../evals/run.sh; fi",
    "evals:hermes:knows": "if [ -d evals ]; then EVAL_RUNTIME=hermes sh evals/run-suite.sh knows.yaml; else EVAL_RUNTIME=hermes sh ../evals/run-suite.sh knows.yaml; fi",
    "evals:hermes:skills": "if [ -d evals ]; then EVAL_RUNTIME=hermes sh evals/run-suite.sh skills.yaml; else EVAL_RUNTIME=hermes sh ../evals/run-suite.sh skills.yaml; fi",
    "evals:hermes:soul": "if [ -d evals ]; then EVAL_RUNTIME=hermes sh evals/run-suite.sh soul.yaml; else EVAL_RUNTIME=hermes sh ../evals/run-suite.sh soul.yaml; fi",
    "evals:hermes:convos": "if [ -d evals ]; then EVAL_RUNTIME=hermes sh evals/run-suite.sh convos.yaml; else EVAL_RUNTIME=hermes sh ../evals/run-suite.sh convos.yaml; fi",
    "evals:hermes:async": "if [ -d evals ]; then EVAL_RUNTIME=hermes sh evals/run-suite.sh async.yaml; else EVAL_RUNTIME=hermes sh ../evals/run-suite.sh async.yaml; fi",
    "evals:hermes:memory": "if [ -d evals ]; then EVAL_RUNTIME=hermes sh evals/run-suite.sh memory.yaml; else EVAL_RUNTIME=hermes sh ../evals/run-suite.sh memory.yaml; fi",
    "ngrok": "ngrok http 18789 --url=c3c882cc6672.ngrok.app",
    "pool-server": "node scripts/pool-server.js",
    "build": "cd ../.. && docker build -f runtime/openclaw/Dockerfile -t convos-runtime:local .",
    "docker:run": "cd ../.. && docker run --rm -p 8080:8080 --env-file runtime/.env -e OPENCLAW_STATE_DIR=/app convos-runtime:local",
    "build:run": "cd ../.. && docker build -f runtime/openclaw/Dockerfile -t convos-runtime:local . && docker run --rm -p 8080:8080 --env-file runtime/.env -e OPENCLAW_STATE_DIR=/app convos-runtime:local"
  }
}
```

Note: `--env-file runtime/.env` stays as-is — `.env` is at the runtime root.

- [ ] **Step 2: Commit**

```bash
git add runtime/openclaw/package.json
git commit -m "fix(runtime): update package.json eval and build paths"
```

---

## Task 4: Consolidate .env and update eval env sourcing

**Files:**
- Modify: `runtime/.env.example` (merge hermes vars in)
- Delete: `runtime/hermes/.env.example`
- Modify: `runtime/evals/adapters/env.sh` (simplify hermes case)
- Modify: `runtime/evals/adapters/openclaw.mjs` (convosPath)
- Modify: `runtime/hermes/scripts/eval-env.sh` (remove redundant line)
- Modify: `runtime/hermes/scripts/dev-run.sh` (point to root .env)
- Modify: `runtime/hermes/scripts/dev-setup.sh` (point to root .env)

Since `.env` stays at `runtime/.env`, the openclaw env.sh case and the main eval-env.sh line need NO changes. Only hermes-specific references to `hermes/.env` need cleanup.

- [ ] **Step 1: Merge hermes vars into runtime/.env.example**

Add the hermes-only vars (`PORT`, `HONCHO_API_KEY`) to `runtime/.env.example`:

```
# Models
OPENCLAW_PRIMARY_MODEL=openrouter/anthropic/claude-sonnet-4-6

# Runtime
XMTP_ENV=dev                                   # "dev" for staging, "production" for production
OPENCLAW_STATE_DIR=/Users/you/.openclaw         # local state dir (outside Docker, openclaw only)
PORT=8080                                       # hermes server port (default 8080)

# Pool proxy — email/SMS calls go through pool manager when these are set.
# In production, pool manager sets these automatically.
POOL_URL=                                       # e.g. http://localhost:3001
INSTANCE_ID=                                    # set by pool manager at instance creation
OPENCLAW_GATEWAY_TOKEN=                         # generated if not set; used for proxy auth

# Public URL (optional — used for services page link)
NGROK_URL=                                     # e.g. https://abc123.ngrok.app

# API keys — always required
OPENROUTER_API_KEY=                            # LLM calls (direct, not proxied)
CONVOS_API_KEY=                                # convos-cli upload provider (attachments)

# Honcho — cross-session user modeling (optional, hermes only).
# When set, the agent builds a persistent model of each user across conversations.
HONCHO_API_KEY=
```

- [ ] **Step 2: Delete runtime/hermes/.env.example**

```bash
git rm runtime/hermes/.env.example
```

- [ ] **Step 3: Simplify env.sh — hermes case**

In `runtime/evals/adapters/env.sh`, the hermes case currently sources two `.env` files:
- Line 22: `$_ENV_HERMES_DIR/.env` (hermes-specific, being eliminated)
- Line 24: `$_ENV_RUNTIME_DIR/.env` (shared, stays)

Remove line 22 (hermes-specific sourcing) and line 23 (the comment). The `$_ENV_RUNTIME_DIR/.env` line on 24 already covers everything.

Also update the error message on line 28:

```sh
# BEFORE (hermes case, lines 20-30):
  hermes)
    _ENV_HERMES_DIR="$_ENV_REPO_ROOT/runtime/hermes"
    [ -f "$_ENV_HERMES_DIR/.env" ] && set -a && . "$_ENV_HERMES_DIR/.env" 2>/dev/null || true && set +a
    # Also source runtime/.env for eval-specific keys (EVAL_OPENROUTER_API_KEY, etc.)
    [ -f "$_ENV_RUNTIME_DIR/.env" ] && set -a && . "$_ENV_RUNTIME_DIR/.env" 2>/dev/null || true && set +a
    export PATH="$_ENV_HERMES_DIR/bin:$PATH"
    export HERMES_EVAL_LOCAL_SERVICES="${HERMES_EVAL_LOCAL_SERVICES:-1}"
    if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
      echo "Error: OPENCLAW_GATEWAY_TOKEN must be set in runtime/hermes/.env" >&2
      exit 1
    fi
    ;;

# AFTER:
  hermes)
    _ENV_HERMES_DIR="$_ENV_REPO_ROOT/runtime/hermes"
    [ -f "$_ENV_RUNTIME_DIR/.env" ] && set -a && . "$_ENV_RUNTIME_DIR/.env" 2>/dev/null || true && set +a
    export PATH="$_ENV_HERMES_DIR/bin:$PATH"
    export HERMES_EVAL_LOCAL_SERVICES="${HERMES_EVAL_LOCAL_SERVICES:-1}"
    if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
      echo "Error: OPENCLAW_GATEWAY_TOKEN must be set in runtime/.env" >&2
      exit 1
    fi
    ;;
```

- [ ] **Step 4: Update openclaw.mjs convosPath**

In `runtime/evals/adapters/openclaw.mjs`, update the convosPath to find convos CLI in openclaw's node_modules:

```js
// BEFORE (line 30):
convosPath: '../../../node_modules/.bin/convos', // repo root node_modules (from evals/)

// AFTER:
convosPath: '../../openclaw/node_modules/.bin/convos',
```

- [ ] **Step 5: Simplify hermes eval-env.sh**

In `runtime/hermes/scripts/eval-env.sh`, line 23 sources `$RUNTIME_DIR/.env` = `runtime/hermes/.env` (being eliminated). Line 24 sources `$REPO_ROOT/runtime/.env` (stays). Remove line 23 as redundant:

```sh
# BEFORE (lines 23-24):
[ -f "$RUNTIME_DIR/.env" ] && set -a && . "$RUNTIME_DIR/.env" 2>/dev/null || true && set +a
[ -f "$REPO_ROOT/runtime/.env" ] && set -a && . "$REPO_ROOT/runtime/.env" 2>/dev/null || true && set +a

# AFTER (single line):
[ -f "$REPO_ROOT/runtime/.env" ] && set -a && . "$REPO_ROOT/runtime/.env" 2>/dev/null || true && set +a
```

- [ ] **Step 6: Update hermes dev-run.sh**

Change `$RUNTIME_DIR/.env` (= `hermes/.env`) to `$RUNTIME_DIR/../.env` (= `runtime/.env`):

```sh
# BEFORE (line 8):
if [ -f "$RUNTIME_DIR/.env" ]; then

# AFTER:
if [ -f "$RUNTIME_DIR/../.env" ]; then
```

And line 10:
```sh
# BEFORE:
  source "$RUNTIME_DIR/.env"

# AFTER:
  source "$RUNTIME_DIR/../.env"
```

- [ ] **Step 7: Update hermes dev-setup.sh**

Change the `.env` check (line 40) to look at root:

```sh
# BEFORE:
if [ ! -f "$RUNTIME_DIR/.env" ]; then
  echo "WARNING: No .env file found. Copy .env.example and fill in your keys:"
  echo "  cp .env.example .env"

# AFTER:
if [ ! -f "$RUNTIME_DIR/../.env" ]; then
  echo "WARNING: No .env file found. Copy .env.example and fill in your keys:"
  echo "  cp ../../../runtime/.env.example ../../../runtime/.env"
```

Also update lines 102-104 (the env sourcing for generated dev-run.sh):

```sh
# BEFORE:
if [ -f "$RUNTIME_DIR/.env" ]; then
  ...
  source "$RUNTIME_DIR/.env"

# AFTER:
if [ -f "$RUNTIME_DIR/../.env" ]; then
  ...
  source "$RUNTIME_DIR/../.env"
```

- [ ] **Step 8: Commit**

```bash
git add runtime/.env.example runtime/evals/adapters/env.sh runtime/evals/adapters/openclaw.mjs \
  runtime/hermes/scripts/eval-env.sh runtime/hermes/scripts/dev-run.sh \
  runtime/hermes/scripts/dev-setup.sh
git commit -m "fix: consolidate .env to runtime root, simplify eval env sourcing"
```

---

## Task 5: Update GitHub Actions workflows

**Files:**
- Modify: `.github/workflows/runtime-pr.yml`
- Modify: `.github/workflows/runtime-dispatch.yml`
- Modify: `.github/workflows/runtime-eval.yml`

Hermes workflows (`runtime-hermes-pr.yml`, `runtime-hermes-dispatch.yml`) are unchanged — they reference `runtime/hermes/` which didn't move.

- [ ] **Step 1: Update runtime-pr.yml**

Three changes:

**a) Path filter** — currently:
```yaml
paths:
  - 'runtime/**'
  - '!runtime/CHANGELOG.md'
  - '!runtime/evals/**'
  - '!runtime/scripts/**'
```
Change to:
```yaml
paths:
  - 'runtime/openclaw/**'
  - '!runtime/openclaw/CHANGELOG.md'
```
(Scripts exclusion no longer needed — they're inside `runtime/openclaw/` and should trigger builds. Evals exclusion no longer needed — evals/ is outside `runtime/openclaw/`.)

**b) Version extraction** — search for `runtime/package.json`, replace with `runtime/openclaw/package.json`

**c) Docker build** — search for `file: runtime/Dockerfile`, replace with `file: runtime/openclaw/Dockerfile`

- [ ] **Step 2: Update runtime-dispatch.yml**

Same two changes:
- `runtime/package.json` → `runtime/openclaw/package.json`
- `file: runtime/Dockerfile` → `file: runtime/openclaw/Dockerfile`

- [ ] **Step 3: Update runtime-eval.yml**

Change all `working-directory: runtime` to `working-directory: runtime/openclaw`. The `.env` creation step should write to `runtime/.env` (the parent), so its working-directory stays `runtime` or uses an explicit path.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/runtime-pr.yml .github/workflows/runtime-dispatch.yml .github/workflows/runtime-eval.yml
git commit -m "fix(ci): update openclaw workflow paths after restructure"
```

---

## Task 6: Update external references (CHANGELOG URLs, docs, AGENTS.md)

**Files:**
- Modify: `pool/frontend/upgrades.html`
- Modify: `runtime/openclaw/workspace/skills/convos-runtime/SKILL.md`
- Modify: `runtime/README.md`
- Modify: `runtime/evals/README.md`
- Modify: `AGENTS.md` (repo root)

- [ ] **Step 1: Update pool/frontend/upgrades.html**

Line 59 — hardcoded GitHub URL:
```html
<!-- BEFORE: -->
href="https://github.com/xmtplabs/convos-agents/blob/dev/runtime/CHANGELOG.md"

<!-- AFTER: -->
href="https://github.com/xmtplabs/convos-agents/blob/dev/runtime/openclaw/CHANGELOG.md"
```

- [ ] **Step 2: Update OpenClaw convos-runtime SKILL.md**

In `runtime/openclaw/workspace/skills/convos-runtime/SKILL.md`, update the raw GitHub URL:
```sh
# BEFORE:
curl -s https://raw.githubusercontent.com/xmtplabs/convos-agents/dev/runtime/CHANGELOG.md

# AFTER:
curl -s https://raw.githubusercontent.com/xmtplabs/convos-agents/dev/runtime/openclaw/CHANGELOG.md
```

- [ ] **Step 3: Update runtime/README.md**

Update all path references:
- `runtime/Dockerfile` → `runtime/openclaw/Dockerfile`
- `runtime/package.json` → `runtime/openclaw/package.json`
- `runtime/scripts/` → `runtime/openclaw/scripts/`
- `cd runtime && pnpm start` → `cd runtime/openclaw && pnpm start`
- Docker build commands: update `-f runtime/Dockerfile` → `-f runtime/openclaw/Dockerfile`
- Update the directory tree diagram to show the new layout
- Note: `.env` references stay as `runtime/.env` (it's still there)

- [ ] **Step 4: Update runtime/evals/README.md**

Update:
- Remove references to `runtime/hermes/.env` — all env now in `runtime/.env`
- Update `cd runtime && pnpm evals` → `cd runtime/openclaw && pnpm evals`

- [ ] **Step 5: Update root AGENTS.md**

Search for `cd runtime` and update to `cd runtime/openclaw` where it refers to OpenClaw build/start commands.

- [ ] **Step 6: Commit**

```bash
git add pool/frontend/upgrades.html \
  runtime/openclaw/workspace/skills/convos-runtime/SKILL.md \
  runtime/README.md runtime/evals/README.md AGENTS.md
git commit -m "docs: update all paths after openclaw restructure"
```

---

## Task 7: Verify everything works

- [ ] **Step 1: Verify Docker build (OpenClaw)**

```bash
cd /path/to/convos-agents
docker build -f runtime/openclaw/Dockerfile -t convos-runtime:test .
```

Expected: build succeeds. Container layout identical to before.

- [ ] **Step 2: Verify Docker build (Hermes)**

```bash
docker build -f runtime/hermes/Dockerfile -t convos-runtime-hermes:test .
```

Expected: build succeeds (was never touched).

- [ ] **Step 3: Verify eval env sourcing (OpenClaw)**

```bash
cd runtime/openclaw
EVAL_RUNTIME=openclaw pnpm evals:knows -- --help 2>&1 | head -5
```

Expected: no "file not found" errors. The `if [ -d evals ]` fallback should trigger `../evals/` locally.

- [ ] **Step 4: Verify eval env sourcing (Hermes)**

```bash
cd runtime/openclaw
EVAL_RUNTIME=hermes pnpm evals:hermes:knows -- --help 2>&1 | head -5
```

Expected: no "file not found" errors.

- [ ] **Step 5: Verify pnpm install in openclaw dir**

```bash
cd runtime/openclaw
pnpm install
```

Expected: installs to `runtime/openclaw/node_modules/`.

- [ ] **Step 6: Verify hermes dev scripts find .env**

```bash
cd runtime/hermes
test -f ../.env && echo ".env found at runtime root" || echo "MISSING"
```

Expected: `.env found at runtime root`

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "refactor(runtime): complete openclaw restructure — runtimes are peers"
```

---

## Out of Scope

1. **Shared workspace content** — extracting common SOUL.md/AGENTS.md into a `shared/` directory. The two runtimes have legitimately different content, so this would require a templating layer.

2. **Extracting shared eval utilities** — `clearDir()` and `runPrompt()` duplication across adapters/providers. Low impact, can be done separately.

3. **`runtime/.eval-home/` at root** — transient eval state directory. Could add to `.gitignore` as a follow-up.
