#!/bin/sh
# Substitute .env vars into config template and write to OpenClaw config.
# Then copy repo skills into clawdbot workspace (copy-missing-only).
set -e

ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

echo ""
echo "apply  env → config"
echo "────────────────────"
. "$ROOT/scripts/env-load.sh"

# Top-level paths (align with entrypoint: config-defaults in Docker, Railway volume)
STATE_DIR="${OPENCLAW_STATE_DIR:-${RAILWAY_VOLUME_MOUNT_PATH:-$HOME/.openclaw}}"
if [ -d "$ROOT/config-defaults" ]; then
  CONFIG_DEFAULTS="${CONFIG_DEFAULTS:-$ROOT/config-defaults}"
else
  CONFIG_DEFAULTS="${CONFIG_DEFAULTS:-$ROOT/config}"
fi
CONFIG="${CONFIG:-$STATE_DIR/openclaw.json}"
TEMPLATE_PATH="${TEMPLATE_PATH:-$CONFIG_DEFAULTS/openclaw.json}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
CONFIG_OUTPUT="${CONFIG_OUTPUT:-$CONFIG}"

export TEMPLATE_PATH ENV_FILE CONFIG_OUTPUT
node "$ROOT/scripts/apply-env-to-config.cjs"

# Inject custom plugins path into the output config (mirrors entrypoint.sh)
PLUGINS_DIR="${OPENCLAW_CUSTOM_PLUGINS_DIR:-$ROOT/extensions}"
if [ -d "$PLUGINS_DIR" ]; then
  PLUGINS_ABS="$(cd "$PLUGINS_DIR" && pwd)"
  jq --arg d "$PLUGINS_ABS" \
    '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = (([$d] + (.paths // [])))))' \
    "$CONFIG_OUTPUT" > "$CONFIG_OUTPUT.tmp" && mv "$CONFIG_OUTPUT.tmp" "$CONFIG_OUTPUT"
  echo "  plugins path → $PLUGINS_ABS"
fi

# Seed skills into clawdbot workspace (only when missing)
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
  copied=""
  skipped=""
  for d in "$SOURCE_SKILLS"/*; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    if [ ! -d "$WORKSPACE_DIR/skills/$name" ]; then
      cp -r "$d" "$WORKSPACE_DIR/skills/"
      copied="${copied:+$copied, }$name"
    else
      skipped="${skipped:+$skipped, }$name"
    fi
  done
  [ -n "$copied" ] && echo "  skills copied  → $copied"
  [ -n "$skipped" ] && echo "  skills ok     → $skipped (already present)"
fi
echo ""
