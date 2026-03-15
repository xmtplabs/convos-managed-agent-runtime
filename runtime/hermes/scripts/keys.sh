#!/bin/sh
# Load env, validate required keys, generate gateway token if needed.
set -e
. "$(dirname "$0")/lib/init.sh"

# ── Version ──────────────────────────────────────────────────────────────
_version="unknown"
for _pkg in "$ROOT/../package.json" "$ROOT/runtime-version.json" "$ROOT/package.json"; do
  if command -v jq >/dev/null 2>&1 && [ -f "$_pkg" ]; then
    _version=$(jq -r '.version // "unknown"' "$_pkg")
    [ "$_version" != "unknown" ] && break
  fi
done
brand_banner "$_version"

brand_section "Provisioning keys"

# ── Required: model key ──────────────────────────────────────────────────
if [ -z "$OPENROUTER_API_KEY" ]; then
  brand_err "OPENROUTER_API_KEY" "required but not set"
  exit 1
fi
brand_ok "OPENROUTER_API_KEY" "set"

# ── Gateway token ────────────────────────────────────────────────────────
if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
  brand_ok "GATEWAY_TOKEN" "from env"
else
  export OPENCLAW_GATEWAY_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  brand_info "GATEWAY_TOKEN" "generated"
fi

# ── Model ────────────────────────────────────────────────────────────────
brand_ok "MODEL" "${OPENCLAW_PRIMARY_MODEL:-${HERMES_MODEL:-anthropic/claude-sonnet-4-6}}"
brand_ok "XMTP_ENV" "${XMTP_ENV:-dev}"

# ── Pool ─────────────────────────────────────────────────────────────────
brand_subsection "pool"
[ -n "$POOL_URL" ] && brand_ok "POOL_URL" "$POOL_URL" || brand_dim "POOL_URL" "not set"
[ -n "$INSTANCE_ID" ] && brand_ok "INSTANCE_ID" "$INSTANCE_ID" || brand_dim "INSTANCE_ID" "not set"

brand_flush
