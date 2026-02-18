#!/bin/sh
# Install extension deps and skill deps (e.g. agentmail) in OPENCLAW_STATE_DIR
set -e
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
. "$(dirname "$0")/lib/init.sh"

# Extensions: pnpm install in each dir with package.json (always run to fix stale/partial installs)
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
  if [ -d "$STATE_DIR/node_modules/agentmail" ]; then
    echo "  Skipping state dir deps (already installed)"
  else
    echo "  Installing state dir deps"
    (cd "$STATE_DIR" && pnpm install --no-frozen-lockfile) || true
  fi
fi

# telnyx-cli: install @telnyx/api-cli globally
if [ -d "$SKILLS_DIR/telnyx-cli" ]; then
  if command -v telnyx >/dev/null 2>&1; then
    echo "  Skipping @telnyx/api-cli (already installed)"
  else
    echo "  Installing @telnyx/api-cli globally"
    pnpm install -g @telnyx/api-cli || npm install -g @telnyx/api-cli || true
  fi
fi

# bankr: install @bankr/cli globally (for bankr prompt, balance, etc.)
if [ -d "$SKILLS_DIR/bankr" ]; then
  if command -v bankr >/dev/null 2>&1; then
    echo "  Skipping @bankr/cli (already installed)"
  else
    echo "  Installing @bankr/cli globally"
    pnpm install -g @bankr/cli || npm install -g @bankr/cli || true
  fi
fi

# convos: add @convos/cli to state dir package.json and install
if [ -d "$EXTENSIONS_DIR/convos" ]; then
  pkg="$STATE_DIR/package.json"
  if [ ! -f "$pkg" ]; then
    echo '{"name":"openclaw-state","private":true,"dependencies":{}}' > "$pkg"
  fi
  if ! grep -q '"@convos/cli"' "$pkg" 2>/dev/null; then
    echo "  Adding @convos/cli to state dir"
    node -e "
      const p=require('$pkg');
      p.dependencies=p.dependencies||{};
      p.dependencies['@convos/cli']=p.dependencies['@convos/cli']||'github:xmtplabs/convos-cli';
      require('fs').writeFileSync('$pkg', JSON.stringify(p,null,2));
    "
  fi
  if [ -d "$STATE_DIR/node_modules/@convos/cli" ]; then
    echo "  Skipping @convos/cli (already installed)"
  else
    echo "  Installing @convos/cli in state dir"
    (cd "$STATE_DIR" && pnpm install --no-frozen-lockfile) || true
  fi
fi

echo "  install-deps done"
