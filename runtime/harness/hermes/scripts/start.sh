#!/bin/sh
# Start the Hermes FastAPI server via uvicorn.
set -e
. "$(dirname "$0")/init.sh"

brand_section "Paths"
brand_dim "" "resolved directories and config"
brand_ok "HERMES_HOME"      "${HERMES_HOME#"$ROOT"/}"
brand_ok "HERMES_AGENT_DIR" "${HERMES_AGENT_DIR#"$ROOT"/}"
brand_ok "SKILLS_ROOT"      "${SKILLS_ROOT#"$ROOT"/}"

brand_section "Server"
brand_dim "" "start Hermes FastAPI server"

brand_ok "PORT" "$PORT"

cd "$ROOT"

# Symlink trajectory files to HERMES_HOME so they persist on the Railway volume.
# Hermes saves trajectory_samples.jsonl to cwd (/app in Docker) which is ephemeral.
for _traj_file in trajectory_samples.jsonl failed_trajectories.jsonl; do
  _vol_path="$HERMES_HOME/$_traj_file"
  touch "$_vol_path"
  # Ensure symlink points to HERMES_HOME (replace stale real files)
  if [ ! -L "$_traj_file" ] || [ "$(readlink "$_traj_file")" != "$_vol_path" ]; then
    rm -f "$_traj_file"
    ln -s "$_vol_path" "$_traj_file"
  fi
done

exec python3 -m src.main
