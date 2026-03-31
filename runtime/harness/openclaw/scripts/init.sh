#!/bin/sh
# Set ROOT, load .env, derive state paths. Source from scripts: . "$(dirname "$0")/init.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# .env: local at runtime/.env (two levels up), Docker doesn't use file-based .env
_ENV_FILE="$ROOT/../../.env"
[ ! -f "$_ENV_FILE" ] && _ENV_FILE="$ROOT/.env"

# Platform init (detects Docker vs local internally)
if [ -d "/app/platform-scripts" ]; then
  . /app/platform-scripts/init-common.sh
else
  . "$ROOT/../lib/init-common.sh"
fi

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

# ── Exports (env vars read by the openclaw binary) ──────────────────────
export OPENCLAW_STATE_DIR="$STATE_DIR"
