#!/bin/sh
# Read keys from env (injected by pool manager) and generate local secrets.
# All keys (OPENROUTER_API_KEY, etc.) must arrive as env vars.
# Email/SMS are proxied via pool manager — no direct API keys needed.
set -e

. "$(dirname "$0")/lib/init.sh"
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

brand_section "Provisioning keys"
[ -n "$RAILWAY_VOLUME_MOUNT_PATH" ] && brand_ok "VOLUME" "$RAILWAY_VOLUME_MOUNT_PATH" || brand_dim "VOLUME" "none"

# ── Hard dependency: agent needs a model key to function ───────────────────

if [ -z "$OPENROUTER_API_KEY" ]; then
  brand_err "OPENROUTER_API_KEY" "required but not set"
  exit 1
fi

# ── Pool ──────────────────────────────────────────────────────────────────
brand_subsection "pool"
[ -n "$POOL_URL" ] && brand_ok "POOL_URL" "$POOL_URL" || brand_dim "POOL_URL" "not set"
[ -n "$INSTANCE_ID" ] && brand_ok "INSTANCE_ID" "$INSTANCE_ID" || brand_dim "INSTANCE_ID" "not set"

# ── Runtime config ────────────────────────────────────────────────────────
brand_subsection "hermes"

if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
  gateway_token="$OPENCLAW_GATEWAY_TOKEN"
  brand_ok "GATEWAY_TOKEN" "from env"
else
  gateway_token=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  export OPENCLAW_GATEWAY_TOKEN="$gateway_token"
  brand_info "GATEWAY_TOKEN" "generated"
fi

_model="${OPENCLAW_PRIMARY_MODEL:-${HERMES_MODEL:-anthropic/claude-sonnet-4-6}}"
brand_ok "MODEL" "$_model"
brand_ok "XMTP_ENV" "${XMTP_ENV:-dev}"

# ── Services ──────────────────────────────────────────────────────────────
brand_subsection "services"
[ -n "$OPENROUTER_API_KEY" ] && brand_ok "OPENROUTER_API_KEY" "set" || brand_dim "OPENROUTER_API_KEY" "not set"

# ── Write .env ─────────────────────────────────────────────────────────────

# Skip .env rewrite when running locally — only rewrite on Railway where
# env vars are injected by the platform and need to be synced to the file.
if [ -n "$RAILWAY_ENVIRONMENT" ]; then
  key="${OPENROUTER_API_KEY:-}"
  pool_url="${POOL_URL:-}"
  instance_id="${INSTANCE_ID:-}"

  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -v '^OPENROUTER_API_KEY=' "$ENV_FILE" 2>/dev/null | grep -v '^OPENCLAW_GATEWAY_TOKEN=' | grep -v '^POOL_URL=' | grep -v '^INSTANCE_ID=' > "$tmp" || true
  echo "OPENCLAW_GATEWAY_TOKEN=$gateway_token" >> "$tmp"
  if [ -n "$key" ]; then echo "OPENROUTER_API_KEY=$key" >> "$tmp"; fi
  if [ -n "$pool_url" ]; then echo "POOL_URL=$pool_url" >> "$tmp"; fi
  if [ -n "$instance_id" ]; then echo "INSTANCE_ID=$instance_id" >> "$tmp"; fi
  mv "$tmp" "$ENV_FILE"

  _env_count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" 2>/dev/null || echo 0)"
  brand_ok ".env" "written ($_env_count vars)"
else
  brand_ok ".env" "loaded (${_env_count:-0} vars)"
fi

brand_flush
