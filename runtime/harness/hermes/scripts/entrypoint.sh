#!/bin/sh
set -e

export CONVOS_REPO_ROOT="/app"

# Persistent volume — redirect HERMES_HOME if Railway volume is mounted.
# This gives persistent memory, sessions, and cron across restarts.
# Skills are synced by sync.sh on every boot.
if [ -n "$RAILWAY_VOLUME_MOUNT_PATH" ]; then
  export HERMES_HOME="${RAILWAY_VOLUME_MOUNT_PATH}/hermes"
  mkdir -p "$HERMES_HOME/skills" "$HERMES_HOME/memories" "$HERMES_HOME/sessions" "$HERMES_HOME/cron"
  echo "  HERMES_HOME      -> $HERMES_HOME (volume-backed)"

  # Persist convos-cli identity keys on the volume (mirrors OpenClaw pool-server.js).
  # Without this, ~/.convos/identities/ lives on the ephemeral filesystem and is
  # lost on every container restart / upgrade, causing "No identity found" errors.
  CONVOS_VOL_DIR="${RAILWAY_VOLUME_MOUNT_PATH}/convos"
  CONVOS_HOME="$(python3 -c 'from pathlib import Path; print(Path.home())')/.convos"
  mkdir -p "$CONVOS_VOL_DIR"
  rm -rf "$CONVOS_HOME"
  ln -sf "$CONVOS_VOL_DIR" "$CONVOS_HOME"
  echo "  ~/.convos        -> $CONVOS_VOL_DIR (volume-backed)"
else
  export HERMES_HOME="${HERMES_HOME:-/app/.hermes}"
  echo "  HERMES_HOME      -> $HERMES_HOME (ephemeral)"
fi

export SKILLS_ROOT="$HERMES_HOME/skills"

exec "$@"
