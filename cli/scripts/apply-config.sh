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
if [ -f "$CONFIG" ]; then
  echo "  ♻️  config exists → preserving provisioned config"
else
  cp "$RUNTIME_DIR/openclaw.json" "$CONFIG"
  echo "  📋 config        → copied template"
fi

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
    # Force plugin load from synced extensions so /web-tools/form and /web-tools/agents work on Railway
    jq --arg d "$STATE_DIR/extensions" '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = [$d]))' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    echo "  🔧 plugins.load.paths → $STATE_DIR/extensions"
  fi
  # Inject browser config when CHROMIUM_PATH is set (Docker sets it; macOS/Linux set in env)
  if [ -n "${CHROMIUM_PATH:-}" ]; then
    jq --arg p "$CHROMIUM_PATH" \
      '.browser.executablePath = $p | .browser.headless = true | .browser.noSandbox = true' \
      "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
    echo "  🔧 browser      → $CHROMIUM_PATH (headless, no-sandbox)"
  fi
fi
unset _PORT

echo "  ⚙️  config      → $CONFIG"

echo "  ✨ done"
echo ""
