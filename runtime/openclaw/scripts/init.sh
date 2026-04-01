#!/bin/sh
# Set ROOT, load .env, derive state paths. Source from scripts: . "$(dirname "$0")/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
_ENV_FILE="$ROOT/.env"
[ ! -f "$_ENV_FILE" ] && [ -f "$ROOT/../.env" ] && _ENV_FILE="$ROOT/../.env"
_init_common="$ROOT/../harness/lib/init-common.sh"
[ ! -f "$_init_common" ] && _init_common="/app/harness/lib/init-common.sh"
. "$_init_common"

# ── Paths ────────────────────────────────────────────────────────────────
if [ -f "$ROOT/openclaw.json" ]; then
  RUNTIME_DIR="$ROOT"
else
  RUNTIME_DIR="$ROOT/openclaw"
fi
STATE_DIR="${OPENCLAW_STATE_DIR:-$ROOT/.openclaw-dev}"
WORKSPACE_DIR="$STATE_DIR/workspace"
SKILLS_DIR="$WORKSPACE_DIR/skills"
SKILLS_ROOT="$SKILLS_DIR"
EXTENSIONS_DIR="$STATE_DIR/extensions"
CONFIG="$STATE_DIR/openclaw.json"

export RUNTIME_DIR STATE_DIR WORKSPACE_DIR SKILLS_DIR SKILLS_ROOT EXTENSIONS_DIR CONFIG
