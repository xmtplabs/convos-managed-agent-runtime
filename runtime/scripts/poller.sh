#!/bin/sh
# Background poller — checks for new emails/SMS and sends notifications
# directly to the convos group chat. No LLM calls at all.

. "$(dirname "$0")/lib/init.sh"
. "$ROOT/scripts/lib/env-load.sh"

POLL_INTERVAL="${POLL_INTERVAL_SECONDS:-60}"
SERVICES="$STATE_DIR/workspace/skills/services/scripts/services.mjs"
CONVOS_BIN="$ROOT/node_modules/.bin/convos"
CONVOS_ENV="${CONVOS_ENV:-dev}"
CREDS_FILE="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/credentials/convos-identity.json"
SESSIONS_DIR="$STATE_DIR/agents/main/sessions"
SESSIONS_INDEX="$SESSIONS_DIR/sessions.json"

log() { printf "[poller] %s %s\n" "$(date +%H:%M:%S)" "$1"; }

get_conversation_id() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.ownerConversationId // empty' "$CREDS_FILE" 2>/dev/null
  else
    grep -o '"ownerConversationId":"[^"]*"' "$CREDS_FILE" 2>/dev/null | cut -d'"' -f4
  fi
}

# Find the session file for the convos group chat
get_session_file() {
  _cid=$(get_conversation_id)
  [ -z "$_cid" ] && return 1
  _key="agent:main:convos:group:$_cid"
  if command -v jq >/dev/null 2>&1; then
    _sid=$(jq -r --arg k "$_key" '.[$k].sessionId // empty' "$SESSIONS_INDEX" 2>/dev/null)
  else
    _sid=$(grep -o "\"$_key\":{\"sessionId\":\"[^\"]*\"" "$SESSIONS_INDEX" 2>/dev/null | grep -o 'sessionId":"[^"]*' | cut -d'"' -f2)
  fi
  [ -n "$_sid" ] && echo "$SESSIONS_DIR/$_sid.jsonl"
}

# Inject a message into the agent's convos session (no LLM call)
inject_context() {
  _sf=$(get_session_file)
  [ -z "$_sf" ] || [ ! -f "$_sf" ] && return 1
  _ts=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  _id=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
  _escaped=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g')
  printf '{"type":"message","id":"%s","parentId":null,"timestamp":"%s","message":{"role":"user","content":[{"type":"text","text":"[Notification from background poller — no reply needed unless the user asks about it]\\n%s"}],"timestamp":%s}}\n' \
    "$_id" "$_ts" "$_escaped" "$(date +%s)000" >> "$_sf"
}

notify() {
  _cid=$(get_conversation_id)
  if [ -z "$_cid" ]; then
    log "no conversation ID in credentials, skipping notify"
    return 1
  fi
  # Send to group chat (visible to users)
  "$CONVOS_BIN" conversation send-text "$_cid" \
    --text "$1" --env "$CONVOS_ENV" 2>/dev/null
  # Inject into agent session context (no LLM call)
  inject_context "$1"
}

# Parse email recent output into one-liners:
#   From: Fabri <fguespe@gmail.com>
#   Body: hello world
#   Attachments: file.pdf
# becomes: You got a new email. "hello world" from Fabri <fguespe@gmail.com> [file.pdf]
format_emails() {
  _from="" _body="" _att=""
  printf '%s\n\n' "$1" | while IFS= read -r line; do
    case "$line" in
      From:*)        _from=$(echo "$line" | sed 's/^From: *//') ;;
      Body:*)        _body=$(echo "$line" | sed 's/^Body: *//' | cut -c1-80) ;;
      Attachments:*) _att=$(echo "$line" | sed 's/^Attachments: *//') ;;
      "")
        if [ -n "$_from" ]; then
          _msg="You got a new email. \"${_body:-(no preview)}\" from $_from"
          [ -n "$_att" ] && _msg="$_msg [$_att]"
          printf '%s\n' "$_msg"
          _from="" _body="" _att=""
        fi
        ;;
    esac
  done
}

# Parse SMS recent output into one-liners:
#   From: +13025551234
#   Text: hey are you free?
# becomes: You got a new text. "hey are you free?" from +13025551234
format_sms() {
  _from="" _text=""
  printf '%s\n\n' "$1" | while IFS= read -r line; do
    case "$line" in
      From:*) _from=$(echo "$line" | sed 's/^From: *//') ;;
      Text:*) _text=$(echo "$line" | sed 's/^Text: *//' | cut -c1-80) ;;
      "")
        if [ -n "$_from" ]; then
          printf 'You got a new text. "%s" from %s\n' "${_text:-(empty)}" "$_from"
          _from="" _text=""
        fi
        ;;
    esac
  done
}

# Reset cursors to "now" so we don't re-report old messages on boot
_now=$(date +%s)000
printf "%s" "$_now" > /tmp/.heartbeat-email-cursor
printf "%s" "$_now" > /tmp/.heartbeat-sms-cursor
unset _now

log "waiting 15s for gateway startup..."
sleep 15
log "started (interval=${POLL_INTERVAL}s, convos=$(get_conversation_id))"

while true; do
  _batch=""

  # Email
  _out=$(node "$SERVICES" email recent --since-last --limit 3 --no-provision 2>/dev/null) || true
  if [ -n "$_out" ] && ! echo "$_out" | grep -q "No new emails"; then
    _msgs=$(format_emails "$_out")
    if [ -n "$_msgs" ]; then
      log "new email detected"
      _batch="$_msgs"
    fi
  fi

  # SMS
  _out=$(node "$SERVICES" sms recent --since-last --limit 3 --no-provision 2>/dev/null) || true
  if [ -n "$_out" ] && ! echo "$_out" | grep -q "No new SMS"; then
    _msgs=$(format_sms "$_out")
    if [ -n "$_msgs" ]; then
      log "new SMS detected"
      if [ -n "$_batch" ]; then
        _batch="$_batch
$_msgs"
      else
        _batch="$_msgs"
      fi
    fi
  fi

  # Send one batched notification
  if [ -n "$_batch" ]; then
    notify "$_batch" || log "notify failed"
  fi

  sleep "$POLL_INTERVAL"
done
