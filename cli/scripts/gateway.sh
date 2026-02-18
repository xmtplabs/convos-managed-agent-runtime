#!/bin/sh
set -e

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/cli/scripts/lib/env-load.sh"

# Load provision-time env overrides from the persistent volume (written by pool-server)
if [ -f "$STATE_DIR/.env.provision" ]; then
  set -a
  . "$STATE_DIR/.env.provision"
  set +a
  echo "  📦 .env.provision loaded ($(grep -cE '^[A-Za-z_]' "$STATE_DIR/.env.provision" 2>/dev/null || echo 0) vars)"
fi

PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-18789}}"
ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"

. "$ROOT/cli/scripts/lib/node-path.sh"

CDP_PORT="${OPENCLAW_CDP_PORT:-18800}"
RELAY_PORT="${OPENCLAW_RELAY_PORT:-18792}"

# --- Clean up any previous gateway processes ---
$ENTRY gateway stop 2>/dev/null || true
# Kill stale openclaw processes by name so Bonjour registrations are released
pkill -9 -f "openclaw-gateway" 2>/dev/null || true
pkill -9 -f "openclaw gateway" 2>/dev/null || true
# Force-kill anything still holding the ports (lsof can return multiple PIDs)
lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti "tcp:$RELAY_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti "tcp:$CDP_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
# Remove stale lock/pid files and let ports + Bonjour registrations clear
rm -f "$STATE_DIR/gateway.pid" "$STATE_DIR/gateway.lock" 2>/dev/null || true
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
  unset _chrome _headless _sandbox _loglevel
fi
echo "  📂 state dir    → $STATE_DIR"

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

exec $ENTRY gateway run
