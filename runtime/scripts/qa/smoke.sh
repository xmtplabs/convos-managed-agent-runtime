#!/bin/sh
# QA smoke tests - verify tools work via direct CLI commands (no agent sessions).
# Requires gateway running.
set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a
. "$ROOT/scripts/lib/paths.sh"
cd "$ROOT"

ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"
. "$ROOT/scripts/lib/node-path.sh"

FAILED=""
QA_TMP=$(mktemp)

pass() { echo "  [PASS] $1"; }
fail() { echo "  [FAIL] $1 -- $2" >&2; FAILED="${FAILED} $1"; }

# run CMD... -- streams live, captures to $QA_TMP for checking
run() { "$@" 2>&1 | tee "$QA_TMP" || true; }
# quiet run -- captures to $QA_TMP without printing
qrun() { "$@" > "$QA_TMP" 2>&1 || true; }

SERVICES="$STATE_DIR/workspace/skills/services/scripts/services.mjs"

# --- Instance info ---
echo ""
echo "=== QA: info ==="
qrun node "$SERVICES" info
QA_EMAIL=$(cat "$QA_TMP" | grep -o '"email": *"[^"]*"' | cut -d'"' -f4)
QA_PHONE=$(cat "$QA_TMP" | grep -o '"phone": *"[^"]*"' | cut -d'"' -f4)
[ -n "$QA_EMAIL" ] && echo "  Email: $QA_EMAIL" || echo "  Email: (none)"
[ -n "$QA_PHONE" ] && echo "  Phone: $QA_PHONE" || echo "  Phone: (none)"

# --- Email (services skill) ---
echo ""
echo "=== QA: email ==="
echo "  > node services.mjs email send --to fabri@xmtp.com"
run node "$SERVICES" email send \
  --to "fabri@xmtp.com" --subject "QA $(date +%s)" --text "Smoke test"
if grep -qi "Sent to" "$QA_TMP"; then
  pass "email"
else
  fail "email" "$(cat "$QA_TMP")"
fi

# --- SMS (services skill) ---
echo ""
echo "=== QA: sms ==="
echo "  > node services.mjs sms send --to +16154376139"
run node "$SERVICES" sms send --to "+16154376139" --text "QA $(date +%s)"
if grep -qi "Sent SMS\|queued\|sent\|delivered\|Message ID" "$QA_TMP"; then
  pass "sms"
else
  fail "sms" "$(cat "$QA_TMP")"
fi

# --- Bankr (disabled — too slow for CI) ---
# echo ""
# echo "=== QA: bankr ==="
# echo "  > bankr prompt 'Check my USDC balance'"
# run bankr prompt 'Check my USDC balance. Reply only: USDC: <amount>'
# if grep -qi "USD\|balance\|0x" "$QA_TMP"; then
#   pass "bankr"
# else
#   fail "bankr" "$(cat "$QA_TMP")"
# fi

# --- Convos CLI ---
echo ""
echo "=== QA: convos ==="
echo "  > convos --version"
run convos --version
if grep -qi "convos-cli" "$QA_TMP"; then
  pass "convos"
else
  fail "convos" "$(cat "$QA_TMP")"
fi

# --- Browser ---
echo ""
echo "=== QA: browser ==="
echo "  > openclaw browser open https://example.com"
run $ENTRY browser open "https://example.com"
if grep -qi "opened\|tab\|target\|navigate\|ok\|success" "$QA_TMP"; then
  pass "browser"
else
  fail "browser" "$(cat "$QA_TMP")"
fi

# --- Email poll ---
echo ""
echo "=== QA: email-poll ==="
qrun node "$SERVICES" email poll --labels received --limit 1
if grep -qi "Subject:\|From:\|Inbox.*message" "$QA_TMP"; then
  grep -E "Subject:|From:|Date:|Preview:" "$QA_TMP" | head -4 | sed 's/^/  /'
  pass "email-poll"
else
  fail "email-poll" "$(cat "$QA_TMP")"
fi

# --- SMS poll ---
echo ""
echo "=== QA: sms-poll ==="
qrun node "$SERVICES" sms poll
if grep -qi "From:\|Text:\|Inbound" "$QA_TMP"; then
  SMS_FROM=$(grep -m1 "From:" "$QA_TMP" | sed 's/.*From: //')
  SMS_DATE=$(grep -m1 "Date:" "$QA_TMP" | sed 's/.*Date: //')
  SMS_TEXT=$(grep -m1 "Text:" "$QA_TMP" | sed 's/.*Text: //')
  echo "  Latest: \"$SMS_TEXT\""
  echo "  From:   $SMS_FROM"
  echo "  Time:   $SMS_DATE"
  pass "sms-poll"
else
  fail "sms-poll" "$(cat "$QA_TMP")"
fi

# --- OpenRouter credits ---
echo ""
echo "=== QA: openrouter-credits ==="
if [ -n "$POOL_URL" ] && [ -n "$INSTANCE_ID" ] && [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
  echo "  > node services.mjs credits (pool)"
  qrun node "$SERVICES" credits
  if grep -qi "remaining\|limit\|usage" "$QA_TMP"; then
    grep -E "remaining|used|limit" "$QA_TMP" | head -3 | sed 's/^/  /'
    pass "openrouter-credits"
  else
    fail "openrouter-credits" "$(cat "$QA_TMP")"
  fi
elif [ -n "$OPENROUTER_API_KEY" ]; then
  echo "  > curl openrouter.ai/api/v1/auth/key"
  CREDITS_JSON=$(curl -s https://openrouter.ai/api/v1/auth/key -H "Authorization: Bearer $OPENROUTER_API_KEY" 2>&1)
  echo "$CREDITS_JSON" > "$QA_TMP"
  USAGE=$(echo "$CREDITS_JSON" | grep -o '"usage":[0-9.]*' | cut -d: -f2)
  LIMIT=$(echo "$CREDITS_JSON" | grep -o '"limit":[0-9.]*' | head -1 | cut -d: -f2)
  if [ -n "$USAGE" ]; then
    if [ -n "$LIMIT" ] && [ "$LIMIT" != "null" ]; then
      REMAINING=$(echo "$LIMIT $USAGE" | awk '{printf "%.2f", $1 - $2}')
      echo "  Balance: \$$REMAINING remaining (\$$USAGE used of \$$LIMIT limit)"
    else
      echo "  Usage: \$$USAGE (no limit set)"
    fi
    pass "openrouter-credits"
  else
    fail "openrouter-credits" "$CREDITS_JSON"
  fi
else
  echo "  [SKIP] no POOL_URL or OPENROUTER_API_KEY set"
fi

rm -f "$QA_TMP"

# --- Summary ---
echo ""
if [ -n "$FAILED" ]; then
  echo "FAILED:$FAILED"
  exit 1
fi
echo "All passed"
