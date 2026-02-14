#!/bin/sh
# Inject ROOT/extensions into config plugins.load.paths. Source after init.sh (ROOT, CONFIG set).
set -e
if [ -d "$ROOT/extensions" ] && [ -f "$CONFIG" ]; then
PLUGINS_ABS="$(cd "$ROOT/extensions" && pwd)"
jq --arg d "$PLUGINS_ABS" \
  '.plugins = ((.plugins // {}) | .load = ((.load // {}) | .paths = (([$d] + (.paths // [])))))' \
  "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
fi
