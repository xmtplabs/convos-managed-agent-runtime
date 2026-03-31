#!/bin/sh
# Shared keys.sh boilerplate: load env, print banner, validate openrouter, show pool.
# Source from runtime keys.sh after init.sh.

ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE" 2>/dev/null || true; set +a
fi

brand_resolve_version "$ROOT/../../package.json" "$ROOT/../runtime-version.json" "$ROOT/../package.json" "/app/runtime-version.json"
brand_banner "$_BRAND_VERSION"

brand_section "Keys"
brand_dim "" "validate API keys and write .env"
[ -n "$RAILWAY_VOLUME_MOUNT_PATH" ] && brand_ok "VOLUME" "$RAILWAY_VOLUME_MOUNT_PATH" || brand_dim "VOLUME" "none"
[ -n "$_RUNTIME_IMAGE" ] && brand_ok "IMAGE" "$_RUNTIME_IMAGE" || brand_dim "IMAGE" "unknown"

. "$PLATFORM_SCRIPTS_DIR/keys-common.sh"

keys_validate_openrouter
keys_show_pool
