#!/bin/sh
# Set ROOT, load .env, derive state paths. Source from scripts: . "$(dirname "$0")/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_LIB="$(cd "$(dirname "$0")/lib" 2>/dev/null && pwd)" || SCRIPT_LIB="$ROOT/scripts/lib"
_ENV_FILE="$ROOT/../.env"
_init_common="$ROOT/../scripts/lib/init-common.sh"
[ ! -f "$_init_common" ] && _init_common="/app/platform-scripts/lib/init-common.sh"
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

export HERMES_HOME HERMES_AGENT_DIR WORKSPACE_DIR SKILLS_ROOT

# ── Node / Python ────────────────────────────────────────────────────────
export NODE_PATH="${NODE_PATH:-$ROOT/node_modules}"
if ! is_docker; then
  _VENV_BIN="$ROOT/.hermes-dev/venv/bin"
  [ -d "$_VENV_BIN" ] && export PATH="$_VENV_BIN:$PATH"
fi
export PATH="$ROOT/node_modules/.bin:$PATH"
if [ -d "$HERMES_AGENT_DIR" ]; then
  case ":${PYTHONPATH:-}:" in
    *":$HERMES_AGENT_DIR:"*) ;;
    *) export PYTHONPATH="$HERMES_AGENT_DIR:$ROOT:${PYTHONPATH:-}" ;;
  esac
fi
