#!/bin/sh
# Inject RUNTIME_DIR/extensions into config plugins.load.paths (OpenClaw schema). Source after init.sh (RUNTIME_DIR, CONFIG set).
set -e
if [ -d "$RUNTIME_DIR/extensions" ] && [ -f "$CONFIG" ]; then
EXTENSIONS_ABS="$(cd "$RUNTIME_DIR/extensions" && pwd)"
jq --arg d "$EXTENSIONS_ABS" \
  '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = (([$d] + (.paths // [])))))' \
  "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
fi
