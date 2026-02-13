#!/bin/sh
# Substitute .env vars into config template and write to OpenClaw config.
# Then copy repo skills into clawdbot workspace (copy-missing-only).
set -e

ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

echo ""
echo "  🧠 Uploading brain"
echo "  ═══════════════════"
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
  echo "  🔌 plugins     → $PLUGINS_ABS"
fi

if [ -n "$CHROMIUM_PATH" ]; then
  jq --arg p "$CHROMIUM_PATH" '.browser.executablePath = $p | .browser.headless = true' \
    "$CONFIG_OUTPUT" > "$CONFIG_OUTPUT.tmp" && mv "$CONFIG_OUTPUT.tmp" "$CONFIG_OUTPUT"
  echo "  🌐 browser     → executablePath=$CHROMIUM_PATH headless=true"
fi

# Replace workspace skills with repo skills (full replace, no merge)
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$STATE_DIR/workspace}"
if [ -d "$ROOT/workspace/skills" ]; then
  SOURCE_SKILLS="$ROOT/workspace/skills"
elif [ -d "$ROOT/workspace-defaults/skills" ]; then
  SOURCE_SKILLS="$ROOT/workspace-defaults/skills"
else
  SOURCE_SKILLS=""
fi
if [ -n "$SOURCE_SKILLS" ]; then
  rm -rf "$WORKSPACE_DIR/skills"
  mkdir -p "$WORKSPACE_DIR/skills"
  for d in "$SOURCE_SKILLS"/*; do
    [ -d "$d" ] || continue
    cp -r "$d" "$WORKSPACE_DIR/skills/"
  done
  names="$(ls -1 "$WORKSPACE_DIR/skills" 2>/dev/null | tr '\n' ',' | sed 's/,$//')"
  [ -n "$names" ] && echo "  🎯 skills      → $names (replaced)"
fi

# Repo workspace path (for both copy and config)
if [ -d "$ROOT/workspace-defaults" ]; then
  REPO_WORKSPACE="$(cd "$ROOT/workspace-defaults" && pwd)"
elif [ -d "$ROOT/workspace" ]; then
  REPO_WORKSPACE="$(cd "$ROOT/workspace" && pwd)"
else
  REPO_WORKSPACE=""
fi

# Copy bootstrap .md files from repo workspace into state workspace
if [ -n "$REPO_WORKSPACE" ]; then
  mkdir -p "$WORKSPACE_DIR"
  md_copied=""
  for f in AGENTS.md SOUL.md USER.md IDENTITY.md TOOLS.md HEARTBEAT.md BOOT.md BOOTSTRAP.md; do
    if [ -f "$REPO_WORKSPACE/$f" ]; then
      cp "$REPO_WORKSPACE/$f" "$WORKSPACE_DIR/$f"
      md_copied="${md_copied:+$md_copied, }$f"
    fi
  done
  [ -n "$md_copied" ] && echo "  📄 bootstrap   → $md_copied"
fi

# Point config at repo workspace so OpenClaw loads those .md files
use_repo="${OPENCLAW_USE_REPO_WORKSPACE:-1}"
if [ "$use_repo" = "1" ] || [ "$use_repo" = "true" ] || [ "$use_repo" = "yes" ]; then
  if [ -d "$REPO_WORKSPACE" ]; then
    jq --arg w "$REPO_WORKSPACE" '.agents.defaults.workspace = $w' \
      "$CONFIG_OUTPUT" > "$CONFIG_OUTPUT.tmp" && mv "$CONFIG_OUTPUT.tmp" "$CONFIG_OUTPUT"
    echo "  📂 workspace   → $REPO_WORKSPACE"
  fi
fi
echo "  ✨ done"
echo ""
