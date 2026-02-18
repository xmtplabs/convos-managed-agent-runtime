#!/bin/sh
# When Railway volume is mounted, put OpenClaw state on it so config/identity persist across redeploys.
if [ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" ]; then
  export OPENCLAW_STATE_DIR="${RAILWAY_VOLUME_MOUNT_PATH}/openclaw"
  # Persist convos CLI identity keys (~/.convos/identities/) on the volume
  mkdir -p "${RAILWAY_VOLUME_MOUNT_PATH}/convos"
  rm -rf "$HOME/.convos"
  ln -s "${RAILWAY_VOLUME_MOUNT_PATH}/convos" "$HOME/.convos"
  echo "[entrypoint] ~/.convos -> ${RAILWAY_VOLUME_MOUNT_PATH}/convos"
fi
exec "$@"
