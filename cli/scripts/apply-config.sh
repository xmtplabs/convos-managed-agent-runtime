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

# Patch gateway port/bind when running in a container (Railway sets PORT=8080)
_PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-}}"
if [ -n "$_PORT" ] && [ "$_PORT" != "18789" ] && command -v jq >/dev/null 2>&1; then
  jq --argjson p "$_PORT" '.gateway.port = $p | .gateway.bind = "lan"' "$CONFIG" > "$CONFIG.tmp" \
    && mv "$CONFIG.tmp" "$CONFIG"
  echo "  🔧 gateway      → port $_PORT, bind lan"
fi
unset _PORT

echo "  ⚙️  config      → $CONFIG"

echo "  ✨ done"
echo ""
