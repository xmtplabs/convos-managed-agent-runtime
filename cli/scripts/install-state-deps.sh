#!/bin/sh
set -e
. "$(dirname "$0")/lib/init.sh"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$STATE_DIR}"
exec "$ROOT/scripts/install-state-deps.sh"
