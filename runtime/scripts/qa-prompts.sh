#!/bin/sh
# QA prompt tests — sends real prompts to the agent, prints all results.
# Review at the end. Requires gateway running.
set -e

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/scripts/lib/env-load.sh"

ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"
SESSION="qa-prompts-$(date +%s)"
COUNT=0

GREEN="\033[32m"
CYAN="\033[36m"
DIM="\033[2m"
BOLD="\033[1m"
RESET="\033[0m"

# Filter: pass test names as args to run only those (e.g. `sh qa-prompts.sh email browser`)
FILTER="$*"

should_run() {
  [ -z "$FILTER" ] && return 0
  for f in $FILTER; do [ "$f" = "$1" ] && return 0; done
  return 1
}

prompt_test() {
  name="$1"; shift
  prompt="$*"

  if ! should_run "$name"; then
    return
  fi

  COUNT=$((COUNT + 1))
  echo ""
  echo "${BOLD}=== QA prompt: ${name} ===${RESET}"
  echo "${DIM}  prompt: ${prompt}${RESET}"
  echo ""

  response=$($ENTRY agent -m "$prompt" --agent main --session-id "${SESSION}-${name}" 2>&1) || true

  echo "${CYAN}  response:${RESET}"
  echo "$response" | sed 's/^/    /'
}

# --- Test cases ---

prompt_test email \
  "Send a random short email to fabri@xmtp.com. Reply: Email sent."

prompt_test sms \
  "Send a random short SMS to +16154376139. Reply: SMS sent."

prompt_test email-poll \
  "Check my latest received email. Reply with: From: <sender>, Subject: <subject>, Body: <preview>."

prompt_test sms-poll \
  "Check my latest received SMS. Reply with: From: <number>, Text: <message>."

prompt_test usdc-balance \
  "Check my USDC balance. Reply: USDC: <amount>."

prompt_test search \
  "Search the current BTC price. Reply: BTC: \$X."

prompt_test browser \
  "Browse https://example.com and tell me what the page says."

prompt_test services-url \
  "What's your services page URL?"

prompt_test topup \
  "How do I top up my credits?"

prompt_test card-balance \
  "Where can I see my card balance?"

# --- Summary ---

echo ""
echo ""
echo "${BOLD}=========================================${RESET}"
echo "  ${GREEN}Done.${RESET} ${COUNT} prompt(s) executed."
echo "${BOLD}=========================================${RESET}"
