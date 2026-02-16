#!/bin/sh
# Clear all accumulated session state so the agent starts fresh.
set -e
. "$(dirname "$0")/lib/init.sh"

ENTRY="${OPENCLAW_ENTRY:-$(command -v openclaw 2>/dev/null || echo npx openclaw)}"
echo "Resetting sessions..."
$ENTRY reset --scope sessions --non-interactive --yes
echo "Sessions reset."
