#!/bin/sh
# Set ROOT, HERMES_HOME, and load .env. Source from scripts: . "$(dirname "$0")/lib/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_LIB="$(cd "$(dirname "$0")/lib" 2>/dev/null && pwd)" || SCRIPT_LIB="$ROOT/scripts/lib"

# Docker detection — single source of truth
is_docker() { [ -d "/opt/hermes-agent" ]; }

# .env — in Docker there's none; local dev keeps it at runtime root
_ENV_FILE="$ROOT/../.env"
[ -f "$_ENV_FILE" ] && set -a && . "$_ENV_FILE" 2>/dev/null || true && set +a

# Hermes home — Docker sets HERMES_HOME via Dockerfile/entrypoint, local dev defaults
if [ -z "$HERMES_HOME" ]; then
  export HERMES_HOME="$ROOT/.hermes-dev/home"
fi

# Hermes agent — Docker: /opt/hermes-agent, local dev: .hermes-dev/hermes-agent
if is_docker; then
  HERMES_AGENT_DIR="/opt/hermes-agent"
else
  HERMES_AGENT_DIR="$ROOT/.hermes-dev/hermes-agent"
fi

# Workspace source of truth
WORKSPACE_DIR="$ROOT/workspace"

# Resolve shared dirs
_resolve="$ROOT/../shared/scripts/lib/resolve-shared.sh"
[ ! -f "$_resolve" ] && _resolve="/app/shared-scripts/lib/resolve-shared.sh"
if [ -f "$_resolve" ]; then
  . "$_resolve"
else
  SHARED_WORKSPACE_DIR=""
  SHARED_SCRIPTS_DIR=""
fi
SKILLS_ROOT="$HERMES_HOME/skills"

# Node/Python paths
export NODE_PATH="${NODE_PATH:-$ROOT/node_modules}"
# Local dev venv (macOS PEP 668) — only activate outside Docker
if ! is_docker; then
  _VENV_BIN="$ROOT/.hermes-dev/venv/bin"
  [ -d "$_VENV_BIN" ] && export PATH="$_VENV_BIN:$PATH"
fi
export PATH="$ROOT/node_modules/.bin:$PATH"
if [ -d "$HERMES_AGENT_DIR" ]; then
  # Only prepend if not already there (Docker sets PYTHONPATH in Dockerfile)
  case ":${PYTHONPATH:-}:" in
    *":$HERMES_AGENT_DIR:"*) ;;
    *) export PYTHONPATH="$HERMES_AGENT_DIR:$ROOT:${PYTHONPATH:-}" ;;
  esac
fi

# Brand helpers — prefer shared copy, fall back to local
if [ -n "${SHARED_SCRIPTS_DIR:-}" ] && [ -f "$SHARED_SCRIPTS_DIR/lib/brand.sh" ]; then
  . "$SHARED_SCRIPTS_DIR/lib/brand.sh"
else
  . "$ROOT/../shared/scripts/lib/brand.sh"
fi
