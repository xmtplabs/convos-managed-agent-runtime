#!/bin/sh
# Shared background poller — auto-discovers and runs poll.sh hooks from skills.
# No LLM calls. Stdout from each hook becomes a notification dispatched via
# the local /convos/notify HTTP endpoint (synthetic system message).
#
# Used by both OpenClaw and Hermes runtimes.
#
# Required env vars:
#   SKILLS_ROOT               — path to skills directory
#
# Optional:
#   POLL_INTERVAL_SECONDS     — polling interval (default: 60)
#   PORT                      — local HTTP port (default: 8080)
#   OPENCLAW_GATEWAY_TOKEN    — bearer token for /convos/notify auth

POLL_INTERVAL="${POLL_INTERVAL_SECONDS:-60}"

log() { printf "[poller] %s %s\n" "$(date +%H:%M:%S)" "$1"; }

# ---- Notify ----

notify() {
  _port="${PORT:-8080}"
  _token="${OPENCLAW_GATEWAY_TOKEN:-}"

  # JSON-escape the notification text (try python3, fall back to awk)
  _escaped=$(printf '%s' "$1" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null) \
    || { _raw=$(printf '%s' "$1" | awk 'BEGIN{ORS=""}{gsub(/\\/,"\\\\");gsub(/"/,"\\\"");gsub(/\t/,"\\t");if(NR>1)printf "\\n";print}'); _escaped="\"$_raw\""; }

  # Write body to temp file to avoid eval and shell quoting issues
  _body="/tmp/.poller-notify-body.json"
  printf '{ "text": %s }' "$_escaped" > "$_body"

  _curl_args="-s -f -X POST http://localhost:$_port/convos/notify -H Content-Type:application/json -d @$_body"
  [ -n "$_token" ] && _curl_args="$_curl_args -H Authorization:Bearer $_token"

  curl $_curl_args >/dev/null 2>&1
  rm -f "$_body"
}

# Reset cursors to "now" so we don't re-report old messages on boot
_now=$(date +%s)000
printf "%s" "$_now" > /tmp/.heartbeat-email-cursor
printf "%s" "$_now" > /tmp/.heartbeat-sms-cursor
unset _now

log "waiting 15s for startup..."
sleep 15
log "started (interval=${POLL_INTERVAL}s)"

# ---- Poll loop ----

while true; do
  _batch=""

  # Auto-discover and run poll.sh from every skill directory
  for _hook in "$SKILLS_ROOT"/*/poll.sh; do
    [ ! -f "$_hook" ] && continue
    _skill_name=$(basename "$(dirname "$_hook")")
    _hook_out=$(sh "$_hook" 2>/dev/null) || true
    if [ -n "$_hook_out" ]; then
      log "[$_skill_name] new activity"
      if [ -n "$_batch" ]; then
        _batch="$_batch
$_hook_out"
      else
        _batch="$_hook_out"
      fi
    fi
  done

  if [ -n "$_batch" ]; then
    notify "$_batch" || log "notify failed"
  fi

  sleep "$POLL_INTERVAL"
done
