#!/bin/sh
# Shared key validation and .env writing logic.
# Requires: ROOT, ENV_FILE, brand helpers loaded.

keys_validate_openrouter() {
  if [ -z "$OPENROUTER_API_KEY" ]; then
    brand_err "OPENROUTER_API_KEY" "required but not set"
    exit 1
  fi
}

keys_show_pool() {
  brand_subsection "pool"
  [ -n "$POOL_URL" ] && brand_ok "POOL_URL" "$POOL_URL" || brand_dim "POOL_URL" "not set"
  [ -n "$INSTANCE_ID" ] && brand_ok "INSTANCE_ID" "$INSTANCE_ID" || brand_dim "INSTANCE_ID" "not set"
}

keys_show_services() {
  brand_subsection "services"
  [ -n "$OPENROUTER_API_KEY" ] && brand_ok "OPENROUTER_API_KEY" "set" || brand_dim "OPENROUTER_API_KEY" "not set"
  [ -n "$EXA_API_KEY" ] && brand_ok "EXA_API_KEY" "set" || brand_dim "EXA_API_KEY" "not set"
  [ -n "$CONVOS_API_KEY" ] && brand_ok "CONVOS_API_KEY" "set" || brand_dim "CONVOS_API_KEY" "not set"
  [ -n "$POSTHOG_API_KEY" ] && brand_ok "POSTHOG_API_KEY" "set" || brand_dim "POSTHOG_API_KEY" "not set"
}

keys_ensure_gateway_token() {
  # Resolve from GATEWAY_TOKEN (preferred) or legacy OPENCLAW_GATEWAY_TOKEN
  if [ -n "$GATEWAY_TOKEN" ]; then
    gateway_token="$GATEWAY_TOKEN"
    brand_ok "GATEWAY_TOKEN" "from env"
  elif [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
    gateway_token="$OPENCLAW_GATEWAY_TOKEN"
    brand_ok "GATEWAY_TOKEN" "from env (legacy name)"
  else
    gateway_token=$(openssl rand -hex 32)
    brand_info "GATEWAY_TOKEN" "generated"
  fi
  export GATEWAY_TOKEN="$gateway_token"
  # Backward compat: old pool managers / runtime code may still read this
  export OPENCLAW_GATEWAY_TOKEN="$gateway_token"
}

keys_write_env() {
  # Skip .env rewrite when running locally — only rewrite on Railway
  if [ -n "$RAILWAY_ENVIRONMENT" ]; then
    key="${OPENROUTER_API_KEY:-}"
    pool_url="${POOL_URL:-}"
    instance_id="${INSTANCE_ID:-}"

    touch "$ENV_FILE"
    tmp=$(mktemp)
    grep -v '^OPENROUTER_API_KEY=' "$ENV_FILE" 2>/dev/null | grep -v '^GATEWAY_TOKEN=' | grep -v '^OPENCLAW_GATEWAY_TOKEN=' | grep -v '^POOL_URL=' | grep -v '^INSTANCE_ID=' > "$tmp" || true
    echo "GATEWAY_TOKEN=$gateway_token" >> "$tmp"
    if [ -n "$key" ]; then echo "OPENROUTER_API_KEY=$key" >> "$tmp"; fi
    if [ -n "$pool_url" ]; then echo "POOL_URL=$pool_url" >> "$tmp"; fi
    if [ -n "$instance_id" ]; then echo "INSTANCE_ID=$instance_id" >> "$tmp"; fi
    mv "$tmp" "$ENV_FILE"

    _env_count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" 2>/dev/null || echo 0)"
    brand_ok ".env" "written ($_env_count vars)"
  else
    brand_ok ".env" "loaded (${_env_count:-0} vars)"
  fi
}
