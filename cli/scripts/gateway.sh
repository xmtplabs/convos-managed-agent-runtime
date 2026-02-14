#!/bin/sh
set -e

. "$(dirname "$0")/lib/init.sh"
cd "$ROOT"
. "$ROOT/cli/scripts/lib/env-load.sh"

PORT="${OPENCLAW_PUBLIC_PORT:-${PORT:-18789}}"
ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"
co
_PATH=""
[ -d "$STATE_DIR/node_modules" ] && _PATH="$STATE_DIR/node_modules"
[ -d "$ROOT/node_modules" ] && _PATH="${_PATH:+$_PATH:}$ROOT/node_modules"
[ -n "$_PATH" ] && export NODE_PATH="$_PATH${NODE_PATH:+:$NODE_PATH}"
unset _PATH

$ENTRY gateway stop 2>/dev/null || true
PID=$(lsof -ti "tcp:$PORT" 2>/dev/null) || true
if [ -n "$PID" ]; then
  kill -9 $PID 2>/dev/null || true
fi

exec $ENTRY gateway run
