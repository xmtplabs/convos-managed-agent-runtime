#!/bin/sh
# Set ROOT, load .env, derive state paths. Source from scripts: . "$(dirname "$0")/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
_ENV_FILE="$ROOT/.env"
[ ! -f "$_ENV_FILE" ] && [ -f "$ROOT/../.env" ] && _ENV_FILE="$ROOT/../.env"
_init_common="$ROOT/../shared/scripts/lib/init-common.sh"
[ ! -f "$_init_common" ] && _init_common="/app/shared-scripts/lib/init-common.sh"
. "$_init_common"

# ── Paths ────────────────────────────────────────────────────────────────
if [ -f "$ROOT/openclaw.json" ]; then
  RUNTIME_DIR="$ROOT"
else
  RUNTIME_DIR="$ROOT/openclaw"
fi
# Docker/Railway set OPENCLAW_STATE_DIR explicitly (e.g. /app).
# Local dev defaults to .openclaw-dev inside the runtime dir (same pattern as hermes).
STATE_DIR="${OPENCLAW_STATE_DIR:-$ROOT/.openclaw-dev}"
export OPENCLAW_STATE_DIR="$STATE_DIR"
WORKSPACE_DIR="$STATE_DIR/workspace"
SKILLS_DIR="$WORKSPACE_DIR/skills"
SKILLS_ROOT="$SKILLS_DIR"
EXTENSIONS_DIR="$STATE_DIR/extensions"
CONFIG="$STATE_DIR/openclaw.json"

CONVOS_HOME="${CONVOS_HOME:-$STATE_DIR/convos}"
export RUNTIME_DIR STATE_DIR WORKSPACE_DIR SKILLS_DIR SKILLS_ROOT EXTENSIONS_DIR CONFIG CONVOS_HOME
