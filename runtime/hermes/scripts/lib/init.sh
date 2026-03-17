#!/bin/sh
# Set ROOT, HERMES_HOME, and load .env. Source from scripts: . "$(dirname "$0")/lib/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_LIB="$(cd "$(dirname "$0")/lib" 2>/dev/null && pwd)" || SCRIPT_LIB="$ROOT/scripts/lib"

# .env — in Docker there's none; local dev keeps it at runtime root
_ENV_FILE="$ROOT/../.env"
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a

# Hermes home — Docker sets HERMES_HOME via Dockerfile/entrypoint, local dev defaults
if [ -z "$HERMES_HOME" ]; then
  export HERMES_HOME="$ROOT/.hermes-dev/home"
fi

# Hermes agent — Docker: /opt/hermes-agent, local dev: .hermes-dev/hermes-agent
if [ -d "/opt/hermes-agent" ]; then
  HERMES_AGENT_DIR="/opt/hermes-agent"
else
  HERMES_AGENT_DIR="$ROOT/.hermes-dev/hermes-agent"
fi

# Workspace source of truth
WORKSPACE_DIR="$ROOT/workspace"

# Shared workspace — in Docker, copied to /app/shared-workspace; locally relative to ROOT
if [ -d "$ROOT/../shared/workspace" ]; then
  SHARED_WORKSPACE_DIR="$ROOT/../shared/workspace"
elif [ -d "/app/shared-workspace" ]; then
  SHARED_WORKSPACE_DIR="/app/shared-workspace"
else
  SHARED_WORKSPACE_DIR=""
fi

# Shared scripts — in Docker, copied to /app/shared-scripts; locally relative to ROOT
if [ -d "$ROOT/../shared/scripts" ]; then
  SHARED_SCRIPTS_DIR="$ROOT/../shared/scripts"
elif [ -d "/app/shared-scripts" ]; then
  SHARED_SCRIPTS_DIR="/app/shared-scripts"
else
  SHARED_SCRIPTS_DIR=""
fi
SKILLS_ROOT="$HERMES_HOME/skills"

# Node/Python paths
export NODE_PATH="${NODE_PATH:-$ROOT/node_modules}"
_VENV_BIN="$ROOT/.hermes-dev/venv/bin"
[ -d "$_VENV_BIN" ] && export PATH="$_VENV_BIN:$PATH"
export PATH="$ROOT/node_modules/.bin:$PATH"
if [ -d "$HERMES_AGENT_DIR" ]; then
  # Only prepend if not already there (Docker sets PYTHONPATH in Dockerfile)
  case ":${PYTHONPATH:-}:" in
    *":$HERMES_AGENT_DIR:"*) ;;
    *) export PYTHONPATH="$HERMES_AGENT_DIR:$ROOT:${PYTHONPATH:-}" ;;
  esac
fi

# Brand helpers
. "$SCRIPT_LIB/brand.sh"
