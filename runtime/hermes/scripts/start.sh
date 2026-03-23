#!/bin/sh
# Start the Hermes FastAPI server via uvicorn.
set -e
. "$(dirname "$0")/init.sh"

brand_section "Paths"
brand_dim "" "resolved directories and config"
brand_ok "HERMES_HOME"      "$HERMES_HOME"
brand_ok "HERMES_AGENT_DIR" "$HERMES_AGENT_DIR"
brand_ok "WORKSPACE_DIR"    "$WORKSPACE_DIR"
brand_ok "SKILLS_ROOT"      "$SKILLS_ROOT"

# --- Seed cron jobs ---
CRON_DIR="$HERMES_HOME/cron" . "$SHARED_SCRIPTS_DIR/crons.sh"

brand_section "Server"
brand_dim "" "start Hermes FastAPI server"

export PORT="${PORT:-8080}"
export SHARED_SCRIPTS_DIR="${SHARED_SCRIPTS_DIR:-}"
brand_ok "PORT" "$PORT"

cd "$ROOT"
exec python3 -m src.main
