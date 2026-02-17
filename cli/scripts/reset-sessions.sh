#!/bin/sh
# Clear all accumulated session state so the agent starts fresh.
set -e
. "$(dirname "$0")/lib/init.sh"

AGENTS_DIR="${STATE_DIR}/agents"
if [ -d "$AGENTS_DIR" ]; then
  echo "Removing sessions in $AGENTS_DIR..."
  for agent in "$AGENTS_DIR"/*/; do
    [ -d "${agent}sessions" ] || continue
    echo "  rm ${agent}sessions"
    rm -rf "${agent}sessions"
  done
  echo "Sessions reset."
else
  echo "No agents dir found at $AGENTS_DIR — nothing to reset."
fi
