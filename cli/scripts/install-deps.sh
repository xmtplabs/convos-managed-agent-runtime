#!/bin/sh
# Install extension deps, symlink skill library deps, and ensure Chrome is available.
# All deps are declared in root package.json (single source of truth).
# CLIs (@telnyx/api-cli, @bankr/cli) resolve via PATH (node-path.sh).
# JS libraries (agentmail) need symlinks because ESM import doesn't use NODE_PATH.
set -e
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
. "$(dirname "$0")/lib/init.sh"
. "$ROOT/cli/scripts/lib/node-path.sh"

echo ""
echo "  📦 Installing deps"
echo "  ═══════════════════"

# ---------------------------------------------------------------------------
# 1. Extensions: pnpm install in each dir with package.json
# ---------------------------------------------------------------------------
for ext in "$EXTENSIONS_DIR"/*; do
  [ -d "$ext" ] && [ -f "$ext/package.json" ] || continue
  echo "  📦 extension    → $ext"
  (cd "$ext" && pnpm install --no-frozen-lockfile) || true
done

# ---------------------------------------------------------------------------
# 2. Skill library deps: symlink from root node_modules into state dir
#    ESM import walks up from the script location (~/.openclaw/workspace/skills/...)
#    and won't find ROOT/node_modules. Symlinks bridge the gap.
#    To add a new JS library dep: add to root package.json, add the name here.
# ---------------------------------------------------------------------------
SKILL_LIBS="agentmail"
mkdir -p "$STATE_DIR/node_modules"
for pkg in $SKILL_LIBS; do
  src="$ROOT/node_modules/$pkg"
  dest="$STATE_DIR/node_modules/$pkg"
  if [ -d "$src" ]; then
    real_src="$(cd "$src" && pwd -P)"
    rm -f "$dest"
    ln -s "$real_src" "$dest"
    echo "  🔗 skill lib    → $pkg -> $real_src"
  fi
done

# ---------------------------------------------------------------------------
# 3. Chrome: ensure a Chrome/Chromium binary is available for the browser tool.
#    Priority: CHROMIUM_PATH env > system Chrome > managed install via @puppeteer/browsers.
#    The managed install goes to $STATE_DIR/browsers/ and is reused across restarts.
# ---------------------------------------------------------------------------
_chrome_cache="$STATE_DIR/browsers"

# Resolve current chrome path from config or env
if [ -n "${CHROMIUM_PATH:-}" ]; then
  _chrome_bin="$CHROMIUM_PATH"
elif command -v jq >/dev/null 2>&1 && [ -f "$CONFIG" ]; then
  _chrome_bin=$(jq -r '.browser.executablePath // ""' "$CONFIG")
else
  _chrome_bin=""
fi

# Check if the resolved binary actually exists
if [ -n "$_chrome_bin" ] && [ -x "$_chrome_bin" ]; then
  echo "  🌐 chrome       → $_chrome_bin (exists)"
else
  # Try common system paths
  _found=""
  for _try in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/usr/bin/chromium" \
    "/usr/bin/chromium-browser" \
    "/usr/bin/google-chrome" \
    "/usr/bin/google-chrome-stable" \
    ; do
    if [ -x "$_try" ]; then
      _found="$_try"
      break
    fi
  done

  if [ -n "$_found" ]; then
    echo "  🌐 chrome       → $_found (system)"
    _chrome_bin="$_found"
  else
    # No Chrome found — install via @puppeteer/browsers
    echo "  🌐 chrome       → not found, installing via @puppeteer/browsers..."
    _install_out=$(npx @puppeteer/browsers install chrome@stable \
      --path "$_chrome_cache" \
      --format "{{path}}" 2>&1) || true

    if [ -n "$_install_out" ] && [ -x "$_install_out" ]; then
      _chrome_bin="$_install_out"
      echo "  ✅ chrome       → installed: $_chrome_bin"
    else
      # Try to find the binary in the cache (install output may include extra text)
      _chrome_bin=$(find "$_chrome_cache" -name "chrome" -o -name "Google Chrome for Testing" 2>/dev/null \
        | while read -r f; do [ -x "$f" ] && echo "$f" && break; done) || true
      if [ -n "$_chrome_bin" ] && [ -x "$_chrome_bin" ]; then
        echo "  ✅ chrome       → installed: $_chrome_bin"
      else
        echo "  ⚠️  chrome       → install failed, browser tool will not work"
        echo "     ↳ Set CHROMIUM_PATH or install Chrome manually"
        _chrome_bin=""
      fi
    fi
  fi
  unset _found _try _install_out

  # Patch config with the resolved binary path
  if [ -n "$_chrome_bin" ] && command -v jq >/dev/null 2>&1 && [ -f "$CONFIG" ]; then
    jq --arg p "$_chrome_bin" '.browser.executablePath = $p' "$CONFIG" > "$CONFIG.tmp" \
      && mv "$CONFIG.tmp" "$CONFIG"
    echo "  🔧 config       → browser.executablePath patched"
  fi
fi
unset _chrome_bin _chrome_cache

echo "  ✨ done"
echo ""
