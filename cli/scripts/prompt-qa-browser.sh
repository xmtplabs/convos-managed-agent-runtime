#!/bin/sh
# Browser QA: send one prompt to the agent to verify the browser tool (form fill + submit).
# Requires gateway running. Uses openclaw agent -m "...".
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

MSG='Open https://convos-managed-dev-production.up.railway.app/web-tools/form, fill the form with test data (name, number, email, time slot), and submit it. Reply with: Form submitted.'

SESSION_ID="prompt-qa-browser-$(date +%s)"
exec $ENTRY agent -m "$MSG" --channel convos --agent main --session-id "$SESSION_ID"
