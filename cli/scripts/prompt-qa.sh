#!/bin/sh
# Prompt QA: send one prompt to the agent to verify email, SMS, BTC search, and USDC balance.
# Requires gateway running (e.g. after pnpm start). Uses openclaw agent -m "...".
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

MSG='Do these four things and reply with one success line each: 1) Send a random short email to fguespe@gmail.com. 2) Send a random short SMS to +16154376139. 3) Search the current BTC price and state it. 4) Check my USDC balance. Reply with: Email sent. SMS sent. BTC: $X. USDC: <balance>.'

# Fresh session per run to avoid context overflow from existing history
SESSION_ID="prompt-qa-$(date +%s)"
exec $ENTRY agent -m "$MSG" --agent main --session-id "$SESSION_ID"
