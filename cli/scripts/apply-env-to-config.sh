#!/bin/sh
# Substitute .env vars into config template, copy skills and workspace bootstrap.
set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo ""
echo "  🧠 Uploading brain"
echo "  ═══════════════════"
VER=$(jq -r .version "$ROOT/package.json" 2>/dev/null || echo "?")
echo "  📌 version     → v$VER"
. "$ROOT/cli/scripts/env-load.sh"

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
echo "  📋 template    → $TEMPLATE_PATH"
echo "  📋 output      → $CONFIG_OUTPUT ($([ -f "$CONFIG_OUTPUT" ] && echo 'overwriting' || echo 'new'))"
node "$ROOT/cli/scripts/apply-env-to-config.cjs"

if [ -f "$CONFIG_OUTPUT" ]; then
  _skip=$(jq -r '.agents.defaults.skipBootstrap // "unset"' "$CONFIG_OUTPUT")
  _ws=$(jq -r '.agents.defaults.workspace // "unset"' "$CONFIG_OUTPUT")
  _subs=$(jq -r '[.agents.list[]? | "\(.id)(\(.workspace // "inherit"))"] | join(", ")' "$CONFIG_OUTPUT")
  echo "  🔍 verify      → skipBootstrap=$_skip workspace=$_ws"
  echo "  🔍 agents      → $_subs"
fi

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

WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$STATE_DIR/workspace}"
SKILLS_DIR="${OPENCLAW_SKILLS_DIR:-$STATE_DIR/skills}"
if [ -d "$ROOT/skills" ]; then
  SOURCE_SKILLS="$ROOT/skills"
elif [ -d "$ROOT/workspace/skills" ]; then
  SOURCE_SKILLS="$ROOT/workspace/skills"
elif [ -d "$ROOT/workspace-defaults/skills" ]; then
  SOURCE_SKILLS="$ROOT/workspace-defaults/skills"
else
  SOURCE_SKILLS=""
fi
if [ -n "$SOURCE_SKILLS" ]; then
  rm -rf "$SKILLS_DIR"
  mkdir -p "$SKILLS_DIR"
  for d in "$SOURCE_SKILLS"/*; do
    [ -d "$d" ] || continue
    cp -r "$d" "$SKILLS_DIR/"
  done
  names="$(ls -1 "$SKILLS_DIR" 2>/dev/null | tr '\n' ',' | sed 's/,$//')"
  [ -n "$names" ] && echo "  🎯 skills      → $names (replaced)"
fi

if [ -d "$ROOT/workspace-defaults" ]; then
  REPO_WORKSPACE="$(cd "$ROOT/workspace-defaults" && pwd)"
elif [ -d "$ROOT/workspace" ]; then
  REPO_WORKSPACE="$(cd "$ROOT/workspace" && pwd)"
else
  REPO_WORKSPACE=""
fi

if [ -n "$REPO_WORKSPACE" ]; then
  mkdir -p "$WORKSPACE_DIR"
  first=1
  for f in "$REPO_WORKSPACE"/*.md; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    cp "$f" "$WORKSPACE_DIR/$fname"
    if [ "$first" = 1 ]; then
      echo "  📄 bootstrap   →"
      first=0
    fi
    echo "      $fname"
  done
fi

_agents_list="$WORKSPACE_DIR/AGENTS.md"
[ -n "$REPO_WORKSPACE" ] && _agents_list="$_agents_list $REPO_WORKSPACE/AGENTS.md"
for ag in $_agents_list; do
  [ -f "$ag" ] || continue
  sed "s/{{VERSION}}/$VER/g" "$ag" > "$ag.tmp" && mv "$ag.tmp" "$ag"
done
[ -f "$WORKSPACE_DIR/AGENTS.md" ] || [ -f "${REPO_WORKSPACE:-}/AGENTS.md" ] && echo "  📌 AGENTS.md    → {{VERSION}} → v$VER"

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
