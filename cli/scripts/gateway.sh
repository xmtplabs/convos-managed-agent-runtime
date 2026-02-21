#!/bin/sh
set -e

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/cli/scripts/lib/env-load.sh"

PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-18789}}"
ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"

. "$ROOT/cli/scripts/lib/node-path.sh"

CDP_PORT="${OPENCLAW_CDP_PORT:-18800}"
RELAY_PORT="${OPENCLAW_RELAY_PORT:-18792}"

# --- Clean up any previous gateway processes ---
$ENTRY gateway stop 2>/dev/null || true
# Kill stale gateway.sh wrapper scripts (excluding ourselves) so their restart
# loops don't respawn the gateway we're about to kill.
_my_pid=$$
for _pid in $(pgrep -f "gateway\.sh" 2>/dev/null); do
  [ "$_pid" = "$_my_pid" ] && continue
  kill -9 "$_pid" 2>/dev/null || true
done
unset _my_pid _pid
# Kill stale openclaw processes by name so Bonjour registrations are released
pkill -9 -f "openclaw-gateway" 2>/dev/null || true
pkill -9 -f "openclaw gateway" 2>/dev/null || true
# Force-kill anything still holding the ports (lsof can return multiple PIDs)
lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti "tcp:$RELAY_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti "tcp:$CDP_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
# Kill stale Chrome processes using the openclaw browser profile (renderers, GPU,
# network helpers don't listen on the CDP port, so port-based kill misses them).
_oc_ud="$STATE_DIR/browser"
pkill -9 -f "user-data-dir=$_oc_ud" 2>/dev/null || true
rm -f "$_oc_ud"/*/user-data/SingletonLock "$_oc_ud"/*/user-data/SingletonSocket 2>/dev/null || true
unset _oc_ud
# Remove stale lock/pid files and let ports + Bonjour registrations clear
rm -f "$STATE_DIR/gateway.pid" "$STATE_DIR/gateway.lock" 2>/dev/null || true
# Clear stale device pairing state so the gateway-client gets a fresh pairing
# with correct scopes (prevents "pairing required" errors on browser relay).
rm -f "$STATE_DIR/devices/pending.json" 2>/dev/null || true
if command -v jq >/dev/null 2>&1 && [ -f "$STATE_DIR/devices/paired.json" ]; then
  jq '
    to_entries
    | map(
        if .value.clientId == "gateway-client"
        then .value.scopes = (.value.scopes + ["operator.read"] | unique)
           | .value.tokens = (
               .value.tokens | to_entries
               | map(.value.scopes = (.value.scopes + ["operator.read"] | unique))
               | from_entries
             )
        else .
        end
      )
    | from_entries
  ' "$STATE_DIR/devices/paired.json" > "$STATE_DIR/devices/paired.json.tmp" \
    && mv "$STATE_DIR/devices/paired.json.tmp" "$STATE_DIR/devices/paired.json" 2>/dev/null || true
fi
sleep 2
# Second pass — kill anything that respawned during the wait
lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti "tcp:$RELAY_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti "tcp:$CDP_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1
echo ""
echo "  🚀 Starting gateway"
echo "  ═══════════════════"

# Port availability checks
_gw_busy=$(lsof -ti "tcp:$PORT" 2>/dev/null) || true
if [ -n "$_gw_busy" ]; then
  echo "  ⚠️  port $PORT    → in use (pid $_gw_busy) — gateway may fail to bind"
else
  echo "  ✅ port $PORT    → available (gateway)"
fi

_relay_busy=$(lsof -ti "tcp:$RELAY_PORT" 2>/dev/null) || true
if [ -n "$_relay_busy" ]; then
  echo "  ⚠️  port $RELAY_PORT   → in use (pid $_relay_busy) — browser relay may conflict"
else
  echo "  ✅ port $RELAY_PORT   → available (browser relay)"
fi
_cdp_busy=$(lsof -ti "tcp:$CDP_PORT" 2>/dev/null) || true
if [ -n "$_cdp_busy" ]; then
  echo "  ⚠️  port $CDP_PORT   → in use (pid $_cdp_busy) — browser CDP may conflict"
else
  echo "  ✅ port $CDP_PORT   → available (browser CDP)"
fi
unset _gw_busy _relay_busy _cdp_busy

# Chrome path (read from the patched config)
if command -v jq >/dev/null 2>&1 && [ -f "$STATE_DIR/openclaw.json" ]; then
  _chrome=$(jq -r '.browser.executablePath // "not set"' "$STATE_DIR/openclaw.json")
  _headless=$(jq -r '.browser.headless // "not set"' "$STATE_DIR/openclaw.json")
  _sandbox=$(jq -r 'if .browser.noSandbox == true then "off" elif .browser.noSandbox == false then "on" else "not set" end' "$STATE_DIR/openclaw.json")
  _loglevel=$(jq -r '.logging.consoleLevel // "not set"' "$STATE_DIR/openclaw.json")
  echo "  🌐 chrome       → $_chrome"
  echo "  🖥  headless     → $_headless"
  echo "  🔒 sandbox      → $_sandbox"
  echo "  📝 log level    → $_loglevel"
  # Browser readiness check
  _browser_ok=true
  _browser_enabled=$(jq -r '.browser.enabled // false' "$STATE_DIR/openclaw.json")
  if [ "$_browser_enabled" != "true" ]; then
    echo "  🌐 browser      → disabled in config"
    _browser_ok=false
  elif [ "$_chrome" = "not set" ] || [ ! -x "$_chrome" ]; then
    echo "  ❌ browser      → chrome not found at $_chrome"
    _browser_ok=false
  else
    _stale_lock="$STATE_DIR/browser/openclaw/user-data/SingletonLock"
    if [ -L "$_stale_lock" ]; then
      _lock_pid=$(readlink "$_stale_lock" 2>/dev/null | sed 's/.*-//')
      if [ -n "$_lock_pid" ] && kill -0 "$_lock_pid" 2>/dev/null; then
        echo "  ⚠️  browser      → stale Chrome (pid $_lock_pid) holding profile lock"
        _browser_ok=false
      else
        rm -f "$_stale_lock" 2>/dev/null || true
      fi
    fi
    _stale_chrome=$(pgrep -f "user-data-dir=$STATE_DIR/browser" 2>/dev/null | head -1) || true
    if [ -n "$_stale_chrome" ]; then
      echo "  ⚠️  browser      → stale Chrome process (pid $_stale_chrome) — killing"
      pkill -9 -f "user-data-dir=$STATE_DIR/browser" 2>/dev/null || true
      rm -f "$STATE_DIR/browser"/*/user-data/SingletonLock 2>/dev/null || true
      sleep 1
    fi
    # Check for bind=lan + ws:// security conflict (browser relay blocks plaintext to non-loopback)
    _gw_bind=$(jq -r '.gateway.bind // "loopback"' "$STATE_DIR/openclaw.json")
    if [ "$_gw_bind" != "loopback" ]; then
      echo "  ⚠️  browser      → gateway.bind=$_gw_bind — browser relay may fail (ws:// to non-loopback)"
      echo "     ↳ Fix: use pool-server.js (keeps gateway on loopback) or set gateway.bind=loopback"
      _browser_ok=false
    fi
    unset _gw_bind
    if [ "$_browser_ok" = "true" ]; then
      echo "  ✅ browser      → ready (chrome $_headless, cdp :$CDP_PORT)"
    fi
  fi
  unset _chrome _headless _sandbox _loglevel _browser_ok _browser_enabled _stale_lock _lock_pid _stale_chrome
fi
echo "  📂 state dir    → $STATE_DIR"
echo "  convos paths"
echo "  ═══════════════════════════════════════════════"
echo "  ROOT              $ROOT"
echo "  STATE_DIR         $STATE_DIR"
echo "  WORKSPACE_DIR     $WORKSPACE_DIR"
echo "  CONFIG            $CONFIG"
echo "  SKILLS_DIR        $SKILLS_DIR"

# OpenRouter credit check
if [ -n "${OPENROUTER_API_KEY:-}" ] && command -v curl >/dev/null 2>&1; then
  _or_resp=$(curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    "https://openrouter.ai/api/v1/auth/key" 2>/dev/null) || true
  if [ -n "$_or_resp" ] && command -v jq >/dev/null 2>&1; then
    _or_limit=$(echo "$_or_resp" | jq -r '.data.limit // empty' 2>/dev/null) || true
    _or_usage=$(echo "$_or_resp" | jq -r '.data.usage // empty' 2>/dev/null) || true
    if [ -n "$_or_limit" ] && [ -n "$_or_usage" ]; then
      _or_remaining=$(echo "$_or_limit - $_or_usage" | bc 2>/dev/null) || true
      if [ -n "$_or_remaining" ]; then
        _or_is_zero=$(echo "$_or_remaining <= 0" | bc 2>/dev/null) || true
        _or_is_low=$(echo "$_or_remaining < 0.5" | bc 2>/dev/null) || true
        if [ "$_or_is_zero" = "1" ]; then
          echo "  ❌ OpenRouter   → NO CREDITS remaining (\$$_or_usage / \$$_or_limit used)"
          echo "     ↳ Agent calls will fail with misleading 'Context overflow' errors"
          echo "     ↳ Top up at https://openrouter.ai/settings/credits"
        elif [ "$_or_is_low" = "1" ]; then
          echo "  ⚠️  OpenRouter   → low credits: \$$_or_remaining remaining (\$$_or_usage / \$$_or_limit used)"
        else
          echo "  💳 OpenRouter   → \$$_or_remaining credits remaining"
        fi
      fi
    fi
  fi
  unset _or_resp _or_limit _or_usage _or_remaining _or_is_zero _or_is_low
fi

echo ""

# In-process restart: SIGUSR1 reloads config inside the same process instead
# of exiting. This prevents the container from dying on config-level changes
# (e.g. model switch via native commands).
export OPENCLAW_NO_RESPAWN=1

# Disable set -e so the restart loop can capture non-zero exit codes
set +e

# --- Restart loop (safety net) ---
# Even with in-process restart, the gateway can still crash from unrelated
# errors. This loop re-launches automatically unless exit code is 0 (clean
# shutdown) or we hit too many rapid crashes in a row.
MAX_RAPID_CRASHES=5
RAPID_WINDOW=30          # seconds — crashes within this window count as rapid
_crash_count=0

while true; do
  _last_start=$(date +%s)
  $ENTRY gateway run
  _exit_code=$?
  _now=$(date +%s)
  _elapsed=$((_now - _last_start))

  # Clean shutdown (exit 0) — do not restart
  if [ "$_exit_code" -eq 0 ]; then
    echo "  [gateway] exited cleanly (code 0) — not restarting"
    break
  fi

  # Track rapid crashes (process lived < RAPID_WINDOW seconds)
  if [ "$_elapsed" -lt "$RAPID_WINDOW" ]; then
    _crash_count=$((_crash_count + 1))
  else
    _crash_count=1
  fi

  if [ "$_crash_count" -ge "$MAX_RAPID_CRASHES" ]; then
    echo "  [gateway] too many rapid crashes ($_crash_count in <${RAPID_WINDOW}s each) — giving up"
    exit "$_exit_code"
  fi

  echo "  [gateway] exited with code $_exit_code — restarting in 2s (crash $_crash_count/$MAX_RAPID_CRASHES)"
  sleep 2
done
