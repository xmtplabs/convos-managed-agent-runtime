#!/bin/sh
# Unified QA: run a single suite against the agent.
# Requires gateway running. Set QA_SUITE env var (email|sms|bankr|search|browser|all).
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

SUITE="${QA_SUITE:-all}"
FAILED=""

run_suite() {
  local suite="$1"
  local msg expect

  case "$suite" in
    email)
      msg='Send a random short email to fguespe@gmail.com. Reply: Email sent.'
      expect='Email sent'
      ;;
    sms)
      msg='Send a random short SMS to +16154376139. Reply: SMS sent.'
      expect='SMS sent'
      ;;
    bankr)
      msg='Check my USDC balance. Reply: USDC: <balance>.'
      expect='USDC:'
      ;;
    search)
      msg='Search the current BTC price. Reply: BTC: $X.'
      expect='BTC:'
      ;;
    browser)
      msg='Open https://convos-agent-main.up.railway.app/web-tools/form, fill the form with test data (name, number, email, time slot), and submit it. After submission a confirmation code appears on the page. Reply with: Form submitted. Confirmation code: <the code>'
      expect='Confirmation code:'
      ;;
    *)
      echo "Unknown suite: $suite" >&2
      echo "Available suites: email, sms, bankr, search, browser, all" >&2
      exit 1
      ;;
  esac

  local session_id="qa-${suite}-$(date +%s)"
  echo "=== QA suite: $suite ==="

  local output
  output=$($ENTRY agent -m "$msg" --agent main --session-id "$session_id" 2>&1) || true
  echo "$output"

  if echo "$output" | grep -qi "$expect"; then
    echo "--- PASS: $suite ---"
  else
    echo "--- FAIL: $suite (expected '$expect' in output) ---" >&2
    FAILED="${FAILED} ${suite}"
  fi
}

if [ "$SUITE" = "all" ]; then
  for s in email sms bankr search browser; do
    run_suite "$s"
  done
  if [ -n "$FAILED" ]; then
    echo ""
    echo "=== FAILED suites:$FAILED ===" >&2
    exit 1
  fi
  echo ""
  echo "=== All suites passed ==="
else
  run_suite "$SUITE"
  if [ -n "$FAILED" ]; then
    exit 1
  fi
fi
