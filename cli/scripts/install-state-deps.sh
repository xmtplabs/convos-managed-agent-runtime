#!/bin/sh
# Install extension deps and skill deps (e.g. agentmail) in OPENCLAW_STATE_DIR
set -e
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
. "$(dirname "$0")/lib/init.sh"

# Extensions: pnpm install in each dir with package.json
for ext in "$EXTENSIONS_DIR"/*; do
  [ -d "$ext" ] && [ -f "$ext/package.json" ] || continue
  echo "  Installing deps: $ext"
  (cd "$ext" && pnpm install --no-frozen-lockfile) || true
done

# agentmail: add to state dir package.json and install
if [ -d "$SKILLS_DIR/agentmail" ]; then
  pkg="$STATE_DIR/package.json"
  if [ ! -f "$pkg" ]; then
    echo '{"name":"openclaw-state","private":true,"dependencies":{}}' > "$pkg"
  fi
  if ! grep -q '"agentmail"' "$pkg" 2>/dev/null; then
    echo "  Adding agentmail to state dir"
    node -e "
      const p=require('$pkg');
      p.dependencies=p.dependencies||{};
      p.dependencies.agentmail=p.dependencies.agentmail||'*';
      require('fs').writeFileSync('$pkg', JSON.stringify(p,null,2));
    "
  fi
  echo "  Installing state dir deps"
  (cd "$STATE_DIR" && pnpm install --no-frozen-lockfile) || true
fi

echo "  install-state-deps done"
