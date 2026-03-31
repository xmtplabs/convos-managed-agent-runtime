#!/bin/sh
# Entrypoint for convos-runtime container.
# Volume setup lives in pool-server.js (Railway startCommand bypasses ENTRYPOINT).
_banner="$(dirname "$0")/../../lib/entrypoint-banner.sh"
[ ! -f "$_banner" ] && _banner="/app/platform-scripts/entrypoint-banner.sh"
[ -f "$_banner" ] && . "$_banner"
exec "$@"
