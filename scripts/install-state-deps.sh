#!/bin/sh
# Install extension and skill deps in OPENCLAW_STATE_DIR (default ~/.openclaw).
# Run after apply-config so extensions/skills exist in state.
set -e

ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
EXTENSIONS_DIR="$STATE_DIR/extensions"

if command -v pnpm >/dev/null 2>&1; then
  INSTALL_CMD="pnpm install"
else
  INSTALL_CMD="npm install"
fi

export HUSKY=0
export NODE_ENV="${NODE_ENV:-development}"

# Extensions: install deps in each extension dir
if [ -d "$EXTENSIONS_DIR" ]; then
  for ext in "$EXTENSIONS_DIR"/*/; do
    [ -f "${ext}package.json" ] || continue
    name=$(basename "$ext")
    echo "[agent] Installing extension deps: $name"
    (cd "$ext" && $INSTALL_CMD)
  done
fi

# Skills (agentmail): ensure state dir has agentmail for skill scripts
if [ -d "$STATE_DIR/skills/agentmail" ]; then
  PKG="$STATE_DIR/package.json"
  if [ ! -f "$PKG" ]; then
    echo '{"private":true,"dependencies":{"agentmail":"latest"}}' > "$PKG"
    echo "[agent] Created $PKG with agentmail"
  elif ! grep -q '"agentmail"' "$PKG" 2>/dev/null; then
    if command -v jq >/dev/null 2>&1; then
      jq '.dependencies += {"agentmail":"latest"}' "$PKG" > "$PKG.tmp" && mv "$PKG.tmp" "$PKG"
      echo "[agent] Added agentmail to $PKG"
    fi
  fi
  if [ -f "$PKG" ] && grep -q '"agentmail"' "$PKG" 2>/dev/null; then
    echo "[agent] Installing agentmail in state dir"
    (cd "$STATE_DIR" && $INSTALL_CMD)
  fi
fi
