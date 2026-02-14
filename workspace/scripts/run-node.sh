#!/bin/sh
# Run node with NODE_PATH so skill scripts (agentmail, etc.) resolve deps from app root.
# Docker/Railway: /app/node_modules; local: entrypoint sets NODE_PATH.
if [ -d "/app/node_modules" ]; then
  export NODE_PATH="/app/node_modules${NODE_PATH:+:$NODE_PATH}"
fi
exec node "$@"
