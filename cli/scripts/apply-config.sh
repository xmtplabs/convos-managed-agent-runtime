#!/bin/sh
# 1. Sync workspace, skills, extensions, landing. 2. Copy config template to state dir (OpenClaw substitutes ${VAR} at load from env).
set -e

. "$(dirname "$0")/lib/init.sh"
. "$ROOT/cli/scripts/lib/env-load.sh"

echo ""
echo "  🧠 Uploading brain"
echo "  ═══════════════════"

. "$ROOT/cli/scripts/lib/sync-openclaw.sh"

mkdir -p "$STATE_DIR"

# Merge repo template into state config, preserving runtime values (e.g.
# channels.convos.identityId, ownerConversationId written during setup).
if [ -f "$CONFIG" ] && command -v jq >/dev/null 2>&1; then
  _CONVOS_RUNTIME=$(jq '.channels.convos // empty' "$CONFIG" 2>/dev/null || true)
  cp "$RUNTIME_DIR/openclaw.json" "$CONFIG"
  if [ -n "$_CONVOS_RUNTIME" ]; then
    jq --argjson cr "$_CONVOS_RUNTIME" '.channels.convos = (.channels.convos // {} | . * $cr)' "$CONFIG" > "$CONFIG.tmp" \
      && mv "$CONFIG.tmp" "$CONFIG"
  fi
  unset _CONVOS_RUNTIME
else
  cp "$RUNTIME_DIR/openclaw.json" "$CONFIG"
fi

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
