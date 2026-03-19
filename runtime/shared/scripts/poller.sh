#!/bin/sh
# Shared background poller — auto-discovers and runs poll.sh hooks from skills.
# No LLM calls. Stdout from each hook becomes a group notification.
#
# Used by both OpenClaw and Hermes runtimes.
#
# Required env vars:
#   SKILLS_ROOT          — path to skills directory
#   CONVOS_ENV           — xmtp environment (dev or production)
#
# Conversation ID resolution (checked in order):
#   1. CONVOS_CONVERSATION_ID env var (Hermes sets this)
#   2. POLLER_CREDS_FILE env var pointing to a convos-identity.json
#
# Optional:
#   POLL_INTERVAL_SECONDS — polling interval (default: 60)
#   POLLER_SESSIONS_DIR   — OpenClaw session dir for JSONL injection (skipped if unset)
#   POLLER_SESSIONS_INDEX — OpenClaw sessions.json path (skipped if unset)

POLL_INTERVAL="${POLL_INTERVAL_SECONDS:-60}"

log() { printf "[poller] %s %s\n" "$(date +%H:%M:%S)" "$1"; }

# ---- Conversation ID ----

get_conversation_id() {
  [ -n "${CONVOS_CONVERSATION_ID:-}" ] && echo "$CONVOS_CONVERSATION_ID" && return
  _cf="${POLLER_CREDS_FILE:-}"
  [ -z "$_cf" ] || [ ! -f "$_cf" ] && return 1
  if command -v jq >/dev/null 2>&1; then
    jq -r '.ownerConversationId // empty' "$_cf" 2>/dev/null
  else
    grep -o '"ownerConversationId":"[^"]*"' "$_cf" 2>/dev/null | cut -d'"' -f4
  fi
}

# ---- JSONL session injection (OpenClaw only) ----

get_session_file() {
  [ -z "${POLLER_SESSIONS_DIR:-}" ] || [ -z "${POLLER_SESSIONS_INDEX:-}" ] && return 1
  [ ! -f "$POLLER_SESSIONS_INDEX" ] && return 1
  _cid=$(get_conversation_id)
  [ -z "$_cid" ] && return 1
  _key="agent:main:convos:group:$_cid"
  if command -v jq >/dev/null 2>&1; then
    _sid=$(jq -r --arg k "$_key" '.[$k].sessionId // empty' "$POLLER_SESSIONS_INDEX" 2>/dev/null)
  else
    _sid=$(grep -o "\"$_key\":{\"sessionId\":\"[^\"]*\"" "$POLLER_SESSIONS_INDEX" 2>/dev/null | grep -o 'sessionId":"[^"]*' | cut -d'"' -f2)
  fi
  [ -n "$_sid" ] && echo "$POLLER_SESSIONS_DIR/$_sid.jsonl"
}

inject_context() {
  _sf=$(get_session_file)
  [ -z "$_sf" ] || [ ! -f "$_sf" ] && return 0
  _ts=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  _id=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
  _escaped=$(printf '%s' "$1" | awk '
    BEGIN { ORS="" }
    { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t")
      if (NR>1) printf "\\n"
      print }
  ')
  printf '{"type":"message","id":"%s","parentId":null,"timestamp":"%s","message":{"role":"user","content":[{"type":"text","text":"[Notification from background poller — no reply needed unless the user asks about it]\\n%s"}],"timestamp":%s}}\n' \
    "$_id" "$_ts" "$_escaped" "$(date +%s)000" >> "$_sf"
}

# ---- Notify ----

notify() {
  _cid=$(get_conversation_id)
  if [ -z "$_cid" ]; then
    log "no conversation ID, skipping notify"
    return 1
  fi
  convos conversation send-text "$_cid" \
    --text "$1" --env "${CONVOS_ENV:-dev}" 2>/dev/null
  inject_context "$1"
}

# ---- Preflight ----

if ! command -v convos >/dev/null 2>&1; then
  log "convos CLI not in PATH — poller disabled"
  exit 0
fi

# Reset cursors to "now" so we don't re-report old messages on boot
_now=$(date +%s)000
printf "%s" "$_now" > /tmp/.heartbeat-email-cursor
printf "%s" "$_now" > /tmp/.heartbeat-sms-cursor
unset _now

log "waiting 15s for startup..."
sleep 15
log "started (interval=${POLL_INTERVAL}s, convos=$(get_conversation_id))"

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
