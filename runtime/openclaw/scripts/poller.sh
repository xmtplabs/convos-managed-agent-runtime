#!/bin/sh
# OpenClaw poller wrapper — sets env vars and delegates to shared poller.
. "$(dirname "$0")/lib/init.sh"
. "$ROOT/scripts/lib/env-load.sh"

# Shared poller — Docker: /app/shared-scripts, local: relative to ROOT
if [ -f "$ROOT/../shared/scripts/poller.sh" ]; then
  SHARED_POLLER="$ROOT/../shared/scripts/poller.sh"
elif [ -f "/app/shared-scripts/poller.sh" ]; then
  SHARED_POLLER="/app/shared-scripts/poller.sh"
else
  echo "[poller] shared poller.sh not found — disabled"
  exit 0
fi

export SKILLS_ROOT="${SKILLS_ROOT:-$STATE_DIR/workspace/skills}"
export CONVOS_ENV="${CONVOS_ENV:-dev}"
export POLLER_CREDS_FILE="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/credentials/convos-identity.json"
export POLLER_SESSIONS_DIR="$STATE_DIR/agents/main/sessions"
export POLLER_SESSIONS_INDEX="$POLLER_SESSIONS_DIR/sessions.json"

exec sh "$SHARED_POLLER"
