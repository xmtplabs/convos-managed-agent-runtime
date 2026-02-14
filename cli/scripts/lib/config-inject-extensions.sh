#!/bin/sh
# Inject ROOT/extensions into config plugins.load.paths (OpenClaw schema). Source after init.sh (ROOT, CONFIG set).
set -e
if [ -d "$ROOT/extensions" ] && [ -f "$CONFIG" ]; then
EXTENSIONS_ABS="$(cd "$ROOT/extensions" && pwd)"
jq --arg d "$EXTENSIONS_ABS" \
  '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = (([$d] + (.paths // [])))))' \
  "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
fi
