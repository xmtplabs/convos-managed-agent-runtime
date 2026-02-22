#!/bin/sh
# Browser self-heal: fix profile locks, device scopes, validate config.
# Runs standalone or sourced by gateway.sh before the gateway starts.
set -e

. "$(dirname "$0")/../lib/init.sh"
. "$ROOT/cli/scripts/lib/env-load.sh"

CDP_PORT="${OPENCLAW_CDP_PORT:-18800}"
RELAY_PORT="${OPENCLAW_RELAY_PORT:-18792}"

echo ""
echo "  🌐 Browser pre-flight"
echo "  ═══════════════════"

# ---------------------------------------------------------------------------
# 1. Remove SingletonLock / SingletonSocket
#    Chrome refuses to start if another instance holds the profile lock.
#    A dead Chrome leaves a dangling symlink pointing to a stale PID.
# ---------------------------------------------------------------------------
_oc_ud="$STATE_DIR/browser"
_cleaned_lock=false
for _lock in "$_oc_ud"/*/user-data/SingletonLock; do
  [ -e "$_lock" ] || [ -L "$_lock" ] || continue
  rm -f "$_lock" 2>/dev/null || true
  _cleaned_lock=true
done
for _sock in "$_oc_ud"/*/user-data/SingletonSocket; do
  [ -e "$_sock" ] || [ -S "$_sock" ] || continue
  rm -f "$_sock" 2>/dev/null || true
  _cleaned_lock=true
done
if [ "$_cleaned_lock" = "true" ]; then
  echo "  ✅ profile lock  → cleaned"
else
  echo "  ✅ profile lock  → clean"
fi
unset _oc_ud _cleaned_lock _lock _sock

# ---------------------------------------------------------------------------
# 2. Fix device pairing scopes
#    The gateway-client device needs operator.read to control Chrome via the
#    browser relay. Older pairing records may be missing this scope, causing
#    "pairing required" errors on scope-upgrade.
# ---------------------------------------------------------------------------
rm -f "$STATE_DIR/devices/pending.json" 2>/dev/null || true
if command -v jq >/dev/null 2>&1 && [ -f "$STATE_DIR/devices/paired.json" ]; then
  _before=$(jq -r '.[].scopes | join(",")' "$STATE_DIR/devices/paired.json" 2>/dev/null) || true
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
  _after=$(jq -r '.[].scopes | join(",")' "$STATE_DIR/devices/paired.json" 2>/dev/null) || true
  if [ "$_before" != "$_after" ]; then
    echo "  ✅ device scopes → patched (added operator.read)"
  else
    echo "  ✅ device scopes → ok"
  fi
  unset _before _after
else
  echo "  ✅ device scopes → no paired devices yet"
fi

# ---------------------------------------------------------------------------
# 3. Validate browser config
#    Check executable, ports, headless, bind mode.
# ---------------------------------------------------------------------------
if command -v jq >/dev/null 2>&1 && [ -f "$STATE_DIR/openclaw.json" ]; then
  _chrome=$(jq -r '.browser.executablePath // "not set"' "$STATE_DIR/openclaw.json")
  _headless=$(jq -r '.browser.headless // "not set"' "$STATE_DIR/openclaw.json")
  _sandbox=$(jq -r 'if .browser.noSandbox == true then "off" elif .browser.noSandbox == false then "on" else "not set" end' "$STATE_DIR/openclaw.json")
  _enabled=$(jq -r '.browser.enabled // false' "$STATE_DIR/openclaw.json")
  _gw_bind=$(jq -r '.gateway.bind // "loopback"' "$STATE_DIR/openclaw.json")

  echo "  🌐 chrome       → $_chrome"
  echo "  🖥  headless     → $_headless"
  echo "  🔒 sandbox      → $_sandbox"

  _browser_ok=true
  if [ "$_enabled" != "true" ]; then
    echo "  ⚠️  browser      → disabled in config (browser.enabled=false)"
    _browser_ok=false
  elif [ "$_chrome" = "not set" ] || [ ! -x "$_chrome" ]; then
    echo "  ❌ browser      → chrome not found at $_chrome"
    _browser_ok=false
  fi

  if [ "$_browser_ok" = "true" ] && [ "$_gw_bind" != "loopback" ]; then
    echo "  ⚠️  browser      → gateway.bind=$_gw_bind — browser relay may fail (ws:// to non-loopback)"
    echo "     ↳ Fix: use pool-server.js (keeps gateway on loopback) or set gateway.bind=loopback"
    _browser_ok=false
  fi

  # Port availability
  _cdp_busy=$(lsof -ti "tcp:$CDP_PORT" 2>/dev/null) || true
  _relay_busy=$(lsof -ti "tcp:$RELAY_PORT" 2>/dev/null) || true
  if [ -n "$_cdp_busy" ]; then
    echo "  ⚠️  port $CDP_PORT   → in use (pid $_cdp_busy)"
    _browser_ok=false
  fi
  if [ -n "$_relay_busy" ]; then
    echo "  ⚠️  port $RELAY_PORT   → in use (pid $_relay_busy)"
    _browser_ok=false
  fi

  if [ "$_browser_ok" = "true" ]; then
    echo "  ✅ browser      → ready (headless=$_headless, cdp=:$CDP_PORT, relay=:$RELAY_PORT)"
  fi

  unset _chrome _headless _sandbox _enabled _gw_bind _browser_ok _cdp_busy _relay_busy
fi

echo "  ✨ done"
echo ""
