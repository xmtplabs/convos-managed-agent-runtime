#!/bin/sh
# Set ROOT, load .env, derive state paths. Source from scripts: . "$(dirname "$0")/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
_ENV_FILE="$ROOT/../../.env"
_init_common="$ROOT/../lib/init-common.sh"
[ ! -f "$_init_common" ] && _init_common="/app/platform-scripts/init-common.sh"
. "$_init_common"

# Docker detection — single source of truth
is_docker() { [ -d "/opt/hermes-agent" ]; }

# ── Paths ────────────────────────────────────────────────────────────────
if [ -z "$HERMES_HOME" ]; then
  HERMES_HOME="$ROOT/.hermes-dev/home"
fi
if is_docker; then
  HERMES_AGENT_DIR="/opt/hermes-agent"
else
  HERMES_AGENT_DIR="$ROOT/.hermes-dev/hermes-agent"
fi
WORKSPACE_DIR="${CONVOS_PLATFORM_DIR:-}"
SKILLS_ROOT="$HERMES_HOME/skills"

# ── Exports (env vars read by Python / uvicorn / child processes) ───────
export HERMES_HOME SKILLS_ROOT
export PORT="${PORT:-8080}"
export NODE_PATH="${NODE_PATH:-$ROOT/node_modules}"
export PATH="$ROOT/node_modules/.bin:$PATH"
if ! is_docker; then
  _VENV_BIN="$ROOT/.hermes-dev/venv/bin"
  [ -d "$_VENV_BIN" ] && export PATH="$_VENV_BIN:$PATH"
fi
if [ -d "$HERMES_AGENT_DIR" ]; then
  case ":${PYTHONPATH:-}:" in
    *":$HERMES_AGENT_DIR:"*) ;;
    *) export PYTHONPATH="$HERMES_AGENT_DIR:$ROOT:${PYTHONPATH:-}" ;;
  esac
fi
