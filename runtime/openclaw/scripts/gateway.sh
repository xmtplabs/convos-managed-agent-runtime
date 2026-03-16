#!/bin/sh
set -e

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/scripts/lib/env-load.sh"
. "$ROOT/scripts/lib/brand.sh"

PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-18789}}"
ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"

. "$ROOT/scripts/lib/node-path.sh"

CDP_PORT="${OPENCLAW_CDP_PORT:-18800}"
RELAY_PORT="${OPENCLAW_RELAY_PORT:-18792}"

# --- Clean up any previous gateway processes ---
$ENTRY gateway stop >/dev/null 2>&1 || true

# Kill stale gateway.sh wrapper scripts (excluding ourselves and ancestors) so
# their restart loops don't respawn the gateway we're about to kill.
_my_pid=$$
# Collect ancestor PIDs so we never kill our own process tree (pnpm -> sh chain)
_ancestors=" $$ "
_ap=$$
while true; do
  _ap=$(ps -o ppid= -p "$_ap" 2>/dev/null | tr -d ' ') || break
  [ -z "$_ap" ] || [ "$_ap" = "0" ] || [ "$_ap" = "1" ] && break
  _ancestors="$_ancestors$_ap "
done
for _pid in $(pgrep -f "gateway\.sh" 2>/dev/null); do
  case "$_ancestors" in *" $_pid "*) continue ;; esac
  kill -9 "$_pid" 2>/dev/null || true
done
unset _my_pid _pid _ap _ancestors
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

brand_section "Launching assistant"

# Port availability checks
_gw_busy=$(lsof -ti "tcp:$PORT" 2>/dev/null) || true
if [ -n "$_gw_busy" ]; then
  brand_warn "port $PORT" "in use (pid $_gw_busy) — may fail to bind"
else
  brand_ok "port $PORT" "available (gateway)"
fi

_relay_busy=$(lsof -ti "tcp:$RELAY_PORT" 2>/dev/null) || true
if [ -n "$_relay_busy" ]; then
  brand_warn "port $RELAY_PORT" "in use (pid $_relay_busy) — relay may conflict"
else
  brand_ok "port $RELAY_PORT" "available (browser relay)"
fi
_cdp_busy=$(lsof -ti "tcp:$CDP_PORT" 2>/dev/null) || true
if [ -n "$_cdp_busy" ]; then
  brand_warn "port $CDP_PORT" "in use (pid $_cdp_busy) — CDP may conflict"
else
  brand_ok "port $CDP_PORT" "available (browser CDP)"
fi
unset _gw_busy _relay_busy _cdp_busy

# Service URL
if [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  brand_ok "SERVICE_URL" "https://$RAILWAY_PUBLIC_DOMAIN"
elif [ -n "$NGROK_URL" ]; then
  brand_ok "SERVICE_URL" "$NGROK_URL (ngrok)"
else
  brand_dim "SERVICE_URL" "localhost"
fi

# Chrome (read from the patched config)
if command -v jq >/dev/null 2>&1 && [ -f "$STATE_DIR/openclaw.json" ]; then
  _chrome=$(jq -r '.browser.executablePath // empty' "$STATE_DIR/openclaw.json")
  [ -n "$_chrome" ] && brand_ok "chrome" "$_chrome"
  unset _chrome
fi

# OpenRouter credit check
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  brand_dim "OpenRouter" "no API key set, skipping credit check"
elif ! command -v curl >/dev/null 2>&1; then
  brand_dim "OpenRouter" "curl not found, skipping credit check"
else
  _or_resp=$(curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    "https://openrouter.ai/api/v1/auth/key" 2>/dev/null) || true
  _or_error=$(echo "$_or_resp" | jq -r '.error.message // empty' 2>/dev/null) || true
  if [ -n "$_or_error" ]; then
    brand_warn "OpenRouter" "credit check failed: $_or_error"
  elif [ -n "$_or_resp" ] && command -v jq >/dev/null 2>&1; then
    _or_limit=$(echo "$_or_resp" | jq -r '.data.limit // empty' 2>/dev/null) || true
    _or_usage=$(echo "$_or_resp" | jq -r '.data.usage // empty' 2>/dev/null) || true
    if [ -n "$_or_usage" ]; then
      if [ -n "$_or_limit" ]; then
        _or_remaining=$(echo "$_or_limit - $_or_usage" | bc 2>/dev/null) || true
        if [ -n "$_or_remaining" ]; then
          _or_is_zero=$(echo "$_or_remaining <= 0" | bc 2>/dev/null) || true
          _or_is_low=$(echo "$_or_remaining < 0.5" | bc 2>/dev/null) || true
          if [ "$_or_is_zero" = "1" ]; then
            brand_err "OpenRouter" "NO CREDITS remaining (\$$_or_usage / \$$_or_limit used)"
            _brand_print "  ${C_RED}   ↳ Assistant calls will fail with misleading 'Context overflow' errors${C_RESET}\n"
            _brand_print "  ${C_RED}   ↳ Top up at https://openrouter.ai/settings/credits${C_RESET}\n"
          elif [ "$_or_is_low" = "1" ]; then
            brand_warn "OpenRouter" "low credits: \$$_or_remaining remaining (\$$_or_usage / \$$_or_limit used)"
          else
            brand_ok "OpenRouter" "\$$_or_remaining credits remaining"
          fi
        else
          brand_warn "OpenRouter" "could not calculate balance"
        fi
      else
        brand_ok "OpenRouter" "\$$_or_usage used (no limit set)"
      fi
    else
      brand_warn "OpenRouter" "unexpected API response (no limit/usage data)"
    fi
  else
    brand_warn "OpenRouter" "credit check failed (empty response)"
  fi
  unset _or_resp _or_error _or_limit _or_usage _or_remaining _or_is_zero _or_is_low
fi


# --- Seed cron jobs ---
. "$ROOT/scripts/crons.sh"

# --- Background poller (email/SMS) ---
# Runs outside the LLM — only pokes the gateway when there's something new.
# Kill any existing poller (pidfile + pattern match for orphans)
_poller_pidfile="/tmp/.openclaw-poller.pid"
if [ -f "$_poller_pidfile" ]; then
  kill "$(cat "$_poller_pidfile")" 2>/dev/null || true
fi
pkill -f "poller.sh" 2>/dev/null || true

# Locate shared poller
if [ -f "$ROOT/../shared/scripts/poller.sh" ]; then
  _shared_poller="$ROOT/../shared/scripts/poller.sh"
elif [ -f "/app/shared-scripts/poller.sh" ]; then
  _shared_poller="/app/shared-scripts/poller.sh"
else
  _shared_poller=""
fi

if [ -n "$_shared_poller" ]; then
  SKILLS_ROOT="${SKILLS_ROOT:-$STATE_DIR/workspace/skills}" \
  CONVOS_ENV="${CONVOS_ENV:-dev}" \
  POLLER_CREDS_FILE="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/credentials/convos-identity.json" \
  POLLER_SESSIONS_DIR="$STATE_DIR/agents/main/sessions" \
  POLLER_SESSIONS_INDEX="$STATE_DIR/agents/main/sessions/sessions.json" \
  sh "$_shared_poller" &
  echo $! > "$_poller_pidfile"
  brand_ok "poller" "started (pid $!, every ${POLL_INTERVAL_SECONDS:-60}s)"
else
  brand_dim "poller" "shared poller.sh not found — disabled"
fi
unset _poller_pidfile _shared_poller

brand_done "Assistant is starting up"
brand_flush

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
    brand_dim "[assistant]" "exited cleanly (code 0) — not restarting"
    brand_flush
    break
  fi

  # Track rapid crashes (process lived < RAPID_WINDOW seconds)
  if [ "$_elapsed" -lt "$RAPID_WINDOW" ]; then
    _crash_count=$((_crash_count + 1))
  else
    _crash_count=1
  fi

  if [ "$_crash_count" -ge "$MAX_RAPID_CRASHES" ]; then
    brand_err "[assistant]" "too many rapid crashes ($_crash_count in <${RAPID_WINDOW}s each) — giving up"
    brand_flush
    exit "$_exit_code"
  fi

  brand_warn "[assistant]" "exited with code $_exit_code — restarting in 2s (crash $_crash_count/$MAX_RAPID_CRASHES)"
  brand_flush
  sleep 2
done
