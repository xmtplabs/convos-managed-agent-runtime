#!/bin/sh
# Services poll hook — checks for new emails and SMS.
# Called by the poller each cycle. Prints notifications to stdout;
# empty stdout = silent. Errors go to stderr (suppressed by poller).
#
# Required env: SKILLS_ROOT

SERVICES="$SKILLS_ROOT/services/scripts/services.mjs"

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

# ---- Check email ----

_email_out=$(node "$SERVICES" email recent --since-last --limit 3 --no-provision 2>&1) || true
if [ -n "$_email_out" ] && ! echo "$_email_out" | grep -q "No new emails"; then
  format_emails "$_email_out"
fi

# ---- Check SMS ----

_sms_out=$(node "$SERVICES" sms recent --since-last --limit 3 --no-provision 2>&1) || true
if [ -n "$_sms_out" ] && ! echo "$_sms_out" | grep -q "No new SMS"; then
  format_sms "$_sms_out"
fi
