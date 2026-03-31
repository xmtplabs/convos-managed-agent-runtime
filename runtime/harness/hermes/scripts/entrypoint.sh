#!/bin/sh
set -e

export CONVOS_REPO_ROOT="/app"

# Persistent volume — redirect HERMES_HOME if Railway volume is mounted.
if [ -n "$RAILWAY_VOLUME_MOUNT_PATH" ]; then
  export HERMES_HOME="${RAILWAY_VOLUME_MOUNT_PATH}/hermes"
  mkdir -p "$HERMES_HOME/skills" "$HERMES_HOME/memories" "$HERMES_HOME/sessions" "$HERMES_HOME/cron"
  echo "  HERMES_HOME      -> $HERMES_HOME (volume-backed)"

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

if [ -f /app/platform-scripts/entrypoint-banner.sh ]; then
  . /app/platform-scripts/entrypoint-banner.sh
elif [ -f "$(dirname "$0")/../../lib/entrypoint-banner.sh" ]; then
  . "$(dirname "$0")/../../lib/entrypoint-banner.sh"
fi
exec "$@"
