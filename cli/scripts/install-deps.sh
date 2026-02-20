#!/bin/sh
# Install extension deps and symlink skill library deps into the state dir.
# All deps are declared in root package.json (single source of truth).
# CLIs (@telnyx/api-cli, @bankr/cli) resolve via PATH (node-path.sh).
# JS libraries (agentmail) need symlinks because ESM import doesn't use NODE_PATH.
set -e
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
. "$(dirname "$0")/lib/init.sh"

# Extensions: pnpm install in each dir with package.json (always run to fix stale/partial installs)
for ext in "$EXTENSIONS_DIR"/*; do
  [ -d "$ext" ] && [ -f "$ext/package.json" ] || continue
  echo "  Installing deps: $ext"
  (cd "$ext" && pnpm install --no-frozen-lockfile) || true
done

# Skill library deps: symlink from root node_modules into state dir so ESM imports resolve.
# ESM import walks up from the script location (~/.openclaw/workspace/skills/...) —
# it won't find ROOT/node_modules. Symlinks bridge the gap.
# To add a new JS library dep: add to root package.json, add the name here.
SKILL_LIBS="agentmail"
mkdir -p "$STATE_DIR/node_modules"
for pkg in $SKILL_LIBS; do
  src="$ROOT/node_modules/$pkg"
  dest="$STATE_DIR/node_modules/$pkg"
  if [ -d "$src" ]; then
    # Resolve pnpm symlink to the real path
    real_src="$(cd "$src" && pwd -P)"
    rm -f "$dest"
    ln -s "$real_src" "$dest"
    echo "  Linked $pkg -> $real_src"
  fi
done

echo "  install-deps done"
