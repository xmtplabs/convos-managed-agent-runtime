#!/bin/sh
# Entrypoint for convos-runtime container.
# Volume setup lives in pool-server.js (Railway startCommand bypasses ENTRYPOINT).
. "$(dirname "$0")/../../lib/entrypoint-banner.sh"
exec "$@"
