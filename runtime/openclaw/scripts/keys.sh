#!/bin/sh
# Read keys from env (injected by pool manager) and generate local secrets.
# All keys (OPENROUTER_API_KEY, etc.) must arrive as env vars.
# Email/SMS are proxied via pool manager — no direct API keys needed.
set -e

. "$(dirname "$0")/lib/init.sh"
# Brand helpers — prefer shared copy, fall back to local
if [ -n "${SHARED_SCRIPTS_DIR:-}" ] && [ -f "$SHARED_SCRIPTS_DIR/lib/brand.sh" ]; then
  . "$SHARED_SCRIPTS_DIR/lib/brand.sh"
else
  . "$ROOT/scripts/lib/brand.sh"
fi
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE" 2>/dev/null || true; set +a
  _env_count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" 2>/dev/null || echo 0)"
fi

_version="unknown"
if command -v jq >/dev/null 2>&1 && [ -f "$ROOT/package.json" ]; then
  _version=$(jq -r '.version // "unknown"' "$ROOT/package.json")
fi
brand_banner "$_version"

brand_section "Provisioning assistant keys"
[ -n "$RAILWAY_VOLUME_MOUNT_PATH" ] && brand_ok "VOLUME" "$RAILWAY_VOLUME_MOUNT_PATH" || brand_dim "VOLUME" "none"

. "$SHARED_SCRIPTS_DIR/lib/keys-common.sh"

keys_validate_openrouter
keys_show_pool

# ── OpenClaw ──────────────────────────────────────────────────────────────
brand_subsection "openclaw"
keys_ensure_gateway_token

if [ -n "$OPENCLAW_PRIMARY_MODEL" ]; then
  brand_ok "OPENCLAW_PRIMARY_MODEL" "$OPENCLAW_PRIMARY_MODEL"
else
  brand_dim "OPENCLAW_PRIMARY_MODEL" "not set"
fi

if [ -n "$XMTP_ENV" ]; then
  brand_ok "XMTP_ENV" "$XMTP_ENV"
else
  brand_dim "XMTP_ENV" "not set"
fi

keys_show_services
keys_write_env
brand_flush
