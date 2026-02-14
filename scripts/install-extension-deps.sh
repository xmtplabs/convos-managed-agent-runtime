#!/bin/sh
# Install node deps in each extension that has package.json (pnpm preferred, else npm).
# Call with ROOT set, or we derive it from script location.
set -e

ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
EXT_DIR="${OPENCLAW_CUSTOM_PLUGINS_DIR:-$ROOT/extensions}"

if [ ! -d "$EXT_DIR" ]; then
  exit 0
fi

if command -v pnpm >/dev/null 2>&1; then
  INSTALL_CMD="pnpm install"
else
  INSTALL_CMD="npm install"
fi

export HUSKY=0
export NODE_ENV="${NODE_ENV:-development}"

for ext in "$EXT_DIR"/*/; do
  [ -f "${ext}package.json" ] || continue
  name=$(basename "$ext")
  echo "[agent] Installing extension deps: $name"
  (cd "$ext" && $INSTALL_CMD)
done
