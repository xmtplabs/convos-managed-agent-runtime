#!/bin/sh
set -e

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/cli/scripts/lib/env-load.sh"

PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-18789}}"
ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"

_PATH=""
[ -d "$STATE_DIR/node_modules" ] && _PATH="$STATE_DIR/node_modules"
[ -d "$ROOT/node_modules" ] && _PATH="${_PATH:+$_PATH:}$ROOT/node_modules"
[ -n "$_PATH" ] && export NODE_PATH="$_PATH${NODE_PATH:+:$NODE_PATH}"
unset _PATH

$ENTRY gateway stop 2>/dev/null || true
PID=$(lsof -ti "tcp:$PORT" 2>/dev/null) || true
if [ -n "$PID" ]; then
  kill -9 $PID 2>/dev/null || true
fi

# --- Pre-start debug summary ---
CDP_PORT=18800
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

_cdp_busy=$(lsof -ti "tcp:$CDP_PORT" 2>/dev/null) || true
if [ -n "$_cdp_busy" ]; then
  echo "  ⚠️  port $CDP_PORT   → in use (pid $_cdp_busy) — browser CDP may conflict"
else
  echo "  ✅ port $CDP_PORT   → available (browser CDP)"
fi
unset _gw_busy _cdp_busy

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
