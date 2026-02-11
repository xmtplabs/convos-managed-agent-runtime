#!/bin/sh
# Substitute .env vars into config template and write to OpenClaw config.
# Then copy repo skills into clawdbot workspace (copy-missing-only).
# Requires: ROOT, CONFIG_DEFAULTS, CONFIG (or TEMPLATE_PATH, ENV_FILE, CONFIG_OUTPUT)
set -e
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
. "$ROOT/scripts/env-load.sh"
CONFIG_DEFAULTS="${CONFIG_DEFAULTS:-$ROOT/config}"
CONFIG="${CONFIG:-${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/openclaw.json}"
TEMPLATE_PATH="${TEMPLATE_PATH:-$CONFIG_DEFAULTS/openclaw.json}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
CONFIG_OUTPUT="${CONFIG_OUTPUT:-$CONFIG}"
export TEMPLATE_PATH ENV_FILE CONFIG_OUTPUT
node "$ROOT/scripts/apply-env-to-config.cjs"

# Seed skills into clawdbot workspace (only when missing)
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$STATE_DIR/workspace}"
if [ -d "$ROOT/workspace/skills" ]; then
  SOURCE_SKILLS="$ROOT/workspace/skills"
elif [ -d "$ROOT/workspace-defaults/skills" ]; then
  SOURCE_SKILLS="$ROOT/workspace-defaults/skills"
else
  SOURCE_SKILLS=""
fi
if [ -n "$SOURCE_SKILLS" ]; then
  mkdir -p "$WORKSPACE_DIR/skills"
  for d in "$SOURCE_SKILLS"/*; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    if [ ! -d "$WORKSPACE_DIR/skills/$name" ]; then
      cp -r "$d" "$WORKSPACE_DIR/skills/"
      echo "[agent] Skills: copied $name → $WORKSPACE_DIR/skills/"
    else
      echo "[agent] Skills: skipped $name (already present)"
    fi
  done
fi
