#!/bin/sh
# QA smoke tests - verify tools work via direct CLI commands (no agent sessions).
# Requires gateway running.
set -e

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/cli/scripts/lib/env-load.sh"

ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"
_PATH=""
[ -d "$STATE_DIR/node_modules" ] && _PATH="$STATE_DIR/node_modules"
[ -d "$ROOT/node_modules" ] && _PATH="${_PATH:+$_PATH:}$ROOT/node_modules"
[ -n "$_PATH" ] && export NODE_PATH="$_PATH${NODE_PATH:+:$NODE_PATH}"
unset _PATH

FAILED=""

pass() { echo "  [PASS] $1"; }
fail() { echo "  [FAIL] $1 -- $2" >&2; FAILED="${FAILED} $1"; }

# --- Email (agentmail script) ---
echo ""
echo "=== QA: email ==="
echo "  > node send-email.mjs --to fabri@xmtp.com"
out=$(node "$STATE_DIR/workspace/skills/agentmail/scripts/send-email.mjs" \
  --to "fabri@xmtp.com" --subject "QA $(date +%s)" --text "Smoke test" 2>&1) || true
echo "  < $out"
if echo "$out" | grep -qi "Sent to"; then
  pass "email"
else
  fail "email" "$out"
fi

# --- SMS (telnyx CLI) ---
echo ""
echo "=== QA: sms ==="
echo "  > telnyx message send --from $TELNYX_PHONE_NUMBER --to +16154376139"
out=$(telnyx message send --from "$TELNYX_PHONE_NUMBER" --to "+16154376139" --text "QA $(date +%s)" 2>&1) || true
echo "  < $out"
if echo "$out" | grep -qi "queued\|sent\|delivered\|id"; then
  pass "sms"
else
  fail "sms" "$out"
fi

# --- Bankr ---
echo ""
echo "=== QA: bankr ==="
echo "  > bankr prompt 'Check my USDC balance'"
out=$(bankr prompt 'Check my USDC balance. Reply only: USDC: <amount>' 2>&1) || true
echo "  < $out"
if echo "$out" | grep -qi "USDC\|balance\|0x"; then
  pass "bankr"
else
  fail "bankr" "$out"
fi

# --- Browser ---
echo ""
echo "=== QA: browser ==="
echo "  > openclaw browser open https://example.com"
out=$($ENTRY browser open "https://example.com" 2>&1) || true
echo "  < $out"
if echo "$out" | grep -qi "opened\|tab\|target\|navigate\|ok\|success"; then
  pass "browser"
else
  fail "browser" "$out"
fi

# --- Summary ---
echo ""
if [ -n "$FAILED" ]; then
  echo "FAILED:$FAILED"
  exit 1
fi
echo "All passed"
