#!/bin/sh
set -e

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/cli/scripts/lib/env-load.sh"

PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-18789}}"
ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"

export OPENCLAW_STATE_DIR="$STATE_DIR"
export OPENCLAW_CONFIG_PATH="$CONFIG"
export OPENCLAW_WORKSPACE_DIR="$WORKSPACE_DIR"
export OPENCLAW_ROOT="$ROOT"
[ -d "$ROOT/node_modules" ] && export NODE_PATH="$ROOT/node_modules${NODE_PATH:+:$NODE_PATH}"

$ENTRY gateway stop 2>/dev/null || true
PID=$(lsof -ti "tcp:$PORT" 2>/dev/null) || true
if [ -n "$PID" ]; then
  kill -9 $PID 2>/dev/null || true
fi

exec $ENTRY gateway run
