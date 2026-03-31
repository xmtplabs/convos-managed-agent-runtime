#!/bin/sh
# Entrypoint for convos-runtime container.
if [ -f /app/platform-scripts/entrypoint-banner.sh ]; then
  . /app/platform-scripts/entrypoint-banner.sh
elif [ -f "$(dirname "$0")/../../lib/entrypoint-banner.sh" ]; then
  . "$(dirname "$0")/../../lib/entrypoint-banner.sh"
fi
exec "$@"
