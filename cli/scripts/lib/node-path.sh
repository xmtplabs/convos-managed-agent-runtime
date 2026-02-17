#!/bin/sh
# Build NODE_PATH so Node resolves extension deps. Source after init.sh.
# Adds: STATE_DIR/node_modules, ROOT/node_modules, each extension root (so require finds extension/node_modules/...).
# Extensions need their own node_modules (install-deps installs); without this, plugins fail with "Cannot find module".
_PATH=""
[ -d "$STATE_DIR/node_modules" ] && _PATH="$STATE_DIR/node_modules"
[ -d "$ROOT/node_modules" ] && _PATH="${_PATH:+$_PATH:}$ROOT/node_modules"
for _ext in "$EXTENSIONS_DIR"/*; do
  [ -d "$_ext" ] && [ -f "$_ext/package.json" ] && _PATH="${_PATH:+$_PATH:}$_ext"
done
[ -n "$_PATH" ] && export NODE_PATH="$_PATH${NODE_PATH:+:$NODE_PATH}"
unset _PATH _ext
