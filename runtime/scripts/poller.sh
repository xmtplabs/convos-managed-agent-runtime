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

log() { printf "[poller] %s %s\n" "$(date +%H:%M:%S)" "$1"; }

get_conversation_id() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.ownerConversationId // empty' "$CREDS_FILE" 2>/dev/null
  else
    grep -o '"ownerConversationId":"[^"]*"' "$CREDS_FILE" 2>/dev/null | cut -d'"' -f4
  fi
}

notify() {
  _cid=$(get_conversation_id)
  if [ -z "$_cid" ]; then
    log "no conversation ID in credentials, skipping notify"
    return 1
  fi
  "$CONVOS_BIN" conversation send-text "$_cid" \
    --text "$1" --env "$CONVOS_ENV" 2>/dev/null
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
  # Email
  _out=$(node "$SERVICES" email recent --since-last --limit 3 --no-provision 2>/dev/null) || true
  if [ -n "$_out" ] && ! echo "$_out" | grep -q "No new emails"; then
    _msgs=$(format_emails "$_out")
    if [ -n "$_msgs" ]; then
      log "new email detected"
      echo "$_msgs" | while IFS= read -r _line; do
        notify "$_line" || log "notify failed (email)"
      done
    fi
  fi

  # SMS
  _out=$(node "$SERVICES" sms recent --since-last --limit 3 --no-provision 2>/dev/null) || true
  if [ -n "$_out" ] && ! echo "$_out" | grep -q "No new SMS"; then
    _msgs=$(format_sms "$_out")
    if [ -n "$_msgs" ]; then
      log "new SMS detected"
      echo "$_msgs" | while IFS= read -r _line; do
        notify "$_line" || log "notify failed (sms)"
      done
    fi
  fi

  sleep "$POLL_INTERVAL"
done
