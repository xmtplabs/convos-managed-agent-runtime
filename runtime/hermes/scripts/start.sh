#!/bin/sh
# Start the Hermes FastAPI server via uvicorn.
set -e
. "$(dirname "$0")/lib/init.sh"

brand_section "Starting server"

export PORT="${PORT:-8080}"
brand_ok "PORT" "$PORT"
brand_ok "HERMES_HOME" "$HERMES_HOME"
brand_flush

cd "$ROOT"
exec python3 -m src.main
