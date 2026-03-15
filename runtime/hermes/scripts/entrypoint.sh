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
else
  echo "  HERMES_HOME      -> ${HERMES_HOME:-/app/.hermes} (ephemeral)"
fi

exec "$@"
