#!/bin/sh
# When Railway volume is mounted, put OpenClaw state on it so config/identity persist across redeploys.
if [ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" ]; then
  export OPENCLAW_STATE_DIR="${RAILWAY_VOLUME_MOUNT_PATH}/openclaw"
fi
exec "$@"
