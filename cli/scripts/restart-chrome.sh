#!/bin/sh
# Force-restart the Chrome instance used by the gateway (CDP port).
# Usage: ./cli/scripts/restart-chrome.sh

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/cli/scripts/lib/env-load.sh"

CDP_PORT="${OPENCLAW_CDP_PORT:-18800}"
STATE_DIR="${OPENCLAW_STATE_DIR:-$ROOT}"

echo "  🔄 Restarting Chrome on CDP port $CDP_PORT ..."

# 1. Kill whatever is on the CDP port
lsof -ti "tcp:$CDP_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1
# Second pass in case it respawned
lsof -ti "tcp:$CDP_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true

# 2. Read Chrome config from openclaw.json
if command -v jq >/dev/null 2>&1 && [ -f "$STATE_DIR/openclaw.json" ]; then
  CHROME_PATH=$(jq -r '.browser.executablePath // ""' "$STATE_DIR/openclaw.json")
  HEADLESS=$(jq -r '.browser.headless // true' "$STATE_DIR/openclaw.json")
  NO_SANDBOX=$(jq -r '.browser.noSandbox // false' "$STATE_DIR/openclaw.json")
else
  CHROME_PATH="${CHROMIUM_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
  HEADLESS=true
  NO_SANDBOX=false
fi

if [ -z "$CHROME_PATH" ] || [ ! -x "$CHROME_PATH" ]; then
  echo "  ❌ Chrome not found at: $CHROME_PATH"
  exit 1
fi

# 3. Build launch flags
FLAGS="--remote-debugging-port=$CDP_PORT --disable-gpu --disable-dev-shm-usage"
[ "$HEADLESS" = "true" ] && FLAGS="$FLAGS --headless=new"
[ "$NO_SANDBOX" = "true" ] && FLAGS="$FLAGS --no-sandbox"

# 4. Launch Chrome in background
echo "  🌐 Launching: $CHROME_PATH"
echo "     flags: $FLAGS"
nohup "$CHROME_PATH" $FLAGS >/dev/null 2>&1 &
CHROME_PID=$!
sleep 2

# 5. Verify it's running
if lsof -ti "tcp:$CDP_PORT" >/dev/null 2>&1; then
  echo "  ✅ Chrome running (pid $CHROME_PID) on port $CDP_PORT"
else
  echo "  ⚠️  Chrome may not have started — check port $CDP_PORT manually"
  exit 1
fi
