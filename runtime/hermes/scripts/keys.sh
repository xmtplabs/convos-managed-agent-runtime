#!/bin/sh
# Read keys from env (injected by pool manager) and generate local secrets.
# All keys (OPENROUTER_API_KEY, etc.) must arrive as env vars.
# Email/SMS are proxied via pool manager — no direct API keys needed.
set -e

. "$(dirname "$0")/init.sh"
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE" 2>/dev/null || true; set +a
  _env_count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" 2>/dev/null || echo 0)"
fi

_version="unknown"
for _pkg in "$ROOT/../package.json" "$ROOT/runtime-version.json" "$ROOT/package.json"; do
  if command -v jq >/dev/null 2>&1 && [ -f "$_pkg" ]; then
    _version=$(jq -r '.version // "unknown"' "$_pkg")
    [ "$_version" != "unknown" ] && break
  fi
done
brand_banner "$_version"

brand_section "Keys"
brand_dim "" "validate API keys and write .env"
[ -n "$RAILWAY_VOLUME_MOUNT_PATH" ] && brand_ok "VOLUME" "$RAILWAY_VOLUME_MOUNT_PATH" || brand_dim "VOLUME" "none"
[ -n "$_RUNTIME_IMAGE" ] && brand_ok "IMAGE" "$_RUNTIME_IMAGE" || brand_dim "IMAGE" "unknown"

. "$LIB_DIR/keys-common.sh"

keys_validate_openrouter
keys_show_pool

# ── Runtime config ────────────────────────────────────────────────────────
brand_subsection "hermes"
keys_ensure_gateway_token

brand_ok "MODEL" "@preset/assistants-pro"
brand_ok "XMTP_ENV" "${XMTP_ENV:-dev}"

keys_show_services
keys_write_env
brand_flush
