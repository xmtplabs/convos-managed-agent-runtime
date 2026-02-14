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
cp "$RUNTIME_DIR/openclaw.json" "$CONFIG"
echo "  ⚙️  config      → $CONFIG"

echo "  ✨ done"
echo ""
