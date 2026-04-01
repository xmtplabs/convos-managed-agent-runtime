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

brand_section "Server"
brand_dim "" "start Hermes FastAPI server"

export PORT="${PORT:-8080}"
export LIB_DIR="${LIB_DIR:-}"
brand_ok "PORT" "$PORT"

cd "$ROOT"

# Symlink trajectory files to HERMES_HOME so they persist on the Railway volume.
# Hermes saves trajectory_samples.jsonl to cwd (/app in Docker) which is ephemeral.
for _traj_file in trajectory_samples.jsonl failed_trajectories.jsonl; do
  _vol_path="$HERMES_HOME/$_traj_file"
  if [ ! -e "$_traj_file" ] && [ ! -L "$_traj_file" ]; then
    touch "$_vol_path"
    ln -s "$_vol_path" "$_traj_file"
    brand_ok "TRAJECTORY" "$_traj_file -> $_vol_path"
  fi
done

# --- ngrok tunnel (when NGROK_URL is set) ---
. "$LIB_DIR/ngrok.sh"

exec python3 -m src.main
