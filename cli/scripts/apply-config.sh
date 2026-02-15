#!/bin/sh
# 1. Sync workspace (includes skills), extensions. 2. Copy config template to state dir (OpenClaw substitutes ${VAR} at load from env).
set -e

. "$(dirname "$0")/lib/init.sh"
. "$ROOT/cli/scripts/lib/env-load.sh"

echo ""
echo "  🧠 Uploading brain"
echo "  ═══════════════════"

. "$ROOT/cli/scripts/lib/sync-openclaw.sh"

mkdir -p "$STATE_DIR"
cp "$RUNTIME_DIR/openclaw.json" "$CONFIG"

# Patch config when running in a container (Railway: PORT=8080, OPENCLAW_STATE_DIR=/app)
if command -v jq >/dev/null 2>&1; then
  _PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-}}"
  if [ -n "$_PORT" ] && [ "$_PORT" != "18789" ]; then
    jq --argjson p "$_PORT" '.gateway.port = $p | .gateway.bind = "lan"' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    echo "  🔧 gateway      → port $_PORT, bind lan"
  fi
  # Workspace path must match where we sync; ~/.openclaw/workspace is wrong when STATE_DIR=/app
  if [ -n "$OPENCLAW_STATE_DIR" ]; then
    jq --arg w "$STATE_DIR/workspace" '.agents.defaults.workspace = $w' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    echo "  🔧 workspace    → $STATE_DIR/workspace"
  fi
fi
unset _PORT

echo "  ⚙️  config      → $CONFIG"

echo "  ✨ done"
echo ""
