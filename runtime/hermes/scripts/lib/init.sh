#!/bin/sh
# Set ROOT, HERMES_HOME, and load .env. Source from scripts: . "$(dirname "$0")/lib/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_ROOT="$(cd "$ROOT/.." && pwd)"

# .env lives at runtime root (shared by all runtimes)
_ENV_FILE="$RUNTIME_ROOT/.env"
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a

# Hermes home — local dev uses .hermes-dev/home, Docker uses HERMES_HOME env
if [ -z "$HERMES_HOME" ]; then
  export HERMES_HOME="$ROOT/.hermes-dev/home"
fi

# Hermes agent source — local dev clones to .hermes-dev/hermes-agent
HERMES_AGENT_DIR="$ROOT/.hermes-dev/hermes-agent"

# Workspace source of truth (checked into git)
WORKSPACE_DIR="$ROOT/workspace"

# Node/Python paths for local dev
export NODE_PATH="${NODE_PATH:-$ROOT/node_modules}"
export PATH="$ROOT/node_modules/.bin:$PATH"
if [ -d "$HERMES_AGENT_DIR" ]; then
  export PYTHONPATH="$HERMES_AGENT_DIR:$ROOT:${PYTHONPATH:-}"
fi

# Brand helpers (shared with openclaw)
. "$RUNTIME_ROOT/openclaw/scripts/lib/brand.sh"
