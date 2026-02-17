#!/bin/sh
# QA smoke tests - verify tools work via direct CLI commands (no agent sessions).
# Requires gateway running.
set -e

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/cli/scripts/lib/env-load.sh"

ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"
. "$ROOT/cli/scripts/lib/node-path.sh"

FAILED=""
QA_TMP=$(mktemp)

pass() { echo "  [PASS] $1"; }
fail() { echo "  [FAIL] $1 -- $2" >&2; FAILED="${FAILED} $1"; }

# run CMD... -- streams live, captures to $QA_TMP for checking
run() { "$@" 2>&1 | tee "$QA_TMP" || true; }

# --- Email (agentmail script) ---
echo ""
echo "=== QA: email ==="
echo "  > node send-email.mjs --to fabri@xmtp.com"
run node "$STATE_DIR/workspace/skills/agentmail/scripts/send-email.mjs" \
  --to "fabri@xmtp.com" --subject "QA $(date +%s)" --text "Smoke test"
if grep -qi "Sent to" "$QA_TMP"; then
  pass "email"
else
  fail "email" "$(cat "$QA_TMP")"
fi

# --- SMS (telnyx CLI) ---
echo ""
echo "=== QA: sms ==="
echo "  > telnyx message send --from $TELNYX_PHONE_NUMBER --to +16154376139"
run telnyx message send --from "$TELNYX_PHONE_NUMBER" --to "+16154376139" --text "QA $(date +%s)"
if grep -qi "queued\|sent\|delivered\|id" "$QA_TMP"; then
  pass "sms"
else
  fail "sms" "$(cat "$QA_TMP")"
fi

# --- Bankr ---
echo ""
echo "=== QA: bankr ==="
echo "  > bankr prompt 'Check my USDC balance'"
run bankr prompt 'Check my USDC balance. Reply only: USDC: <amount>'
if grep -qi "USDC\|balance\|0x" "$QA_TMP"; then
  pass "bankr"
else
  fail "bankr" "$(cat "$QA_TMP")"
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

rm -f "$QA_TMP"

# --- Summary ---
echo ""
if [ -n "$FAILED" ]; then
  echo "FAILED:$FAILED"
  exit 1
fi
echo "All passed"
