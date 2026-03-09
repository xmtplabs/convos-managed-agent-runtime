#!/bin/sh
# Read keys from env (injected by pool manager) and generate local secrets.
# All tool keys (OPENROUTER_API_KEY, AGENTMAIL_INBOX_ID, etc.) must arrive
# as env vars — this script does not provision them.
set -e

. "$(dirname "$0")/lib/init.sh"
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE" 2>/dev/null || true; set +a; fi

# ── Version banner ────────────────────────────────────────────────────────
_version="unknown"
if command -v jq >/dev/null 2>&1 && [ -f "$ROOT/package.json" ]; then
  _version=$(jq -r '.version // "unknown"' "$ROOT/package.json")
fi
echo ""
echo "  convos-runtime v${_version}"
echo "  ═══════════════════════════"
echo ""
echo "  🔑 Provisioning keys"
echo "  ═══════════════════"
echo ""
[ -n "$RAILWAY_VOLUME_MOUNT_PATH" ] && echo "  📦 VOLUME                  → $RAILWAY_VOLUME_MOUNT_PATH" || echo "  ⬚  VOLUME                  → none"

# ── Hard dependency: agent needs a model key to function ───────────────────

if [ -z "$OPENROUTER_API_KEY" ]; then
  echo "  ❌ OPENROUTER_API_KEY is required but not set" >&2
  exit 1
fi

# ── Pool ──────────────────────────────────────────────────────────────────
echo ""
echo "  ── pool ──────────────────────"
[ -n "$POOL_URL" ] && echo "  ✅ POOL_URL                → $POOL_URL" || echo "  ⬚  POOL_URL                → not set"
[ -n "$INSTANCE_ID" ] && echo "  ✅ INSTANCE_ID             → $INSTANCE_ID" || echo "  ⬚  INSTANCE_ID             → not set"
if [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  echo "  ✅ SERVICE_URL             → https://$RAILWAY_PUBLIC_DOMAIN"
elif [ -n "$NGROK_URL" ]; then
  echo "  ✅ SERVICE_URL             → $NGROK_URL (ngrok)"
else
  echo "  ⬚  SERVICE_URL             → localhost"
fi

# ── OpenClaw ──────────────────────────────────────────────────────────────
echo ""
echo "  ── openclaw ──────────────────"

if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
  gateway_token="$OPENCLAW_GATEWAY_TOKEN"
  echo "  ✅ OPENCLAW_GATEWAY_TOKEN  → from env"
else
  gateway_token=$(openssl rand -hex 32)
  echo "  🔧 OPENCLAW_GATEWAY_TOKEN  → generated"
fi

if [ -n "$OPENCLAW_PRIMARY_MODEL" ]; then
  echo "  ✅ OPENCLAW_PRIMARY_MODEL  → $OPENCLAW_PRIMARY_MODEL"
else
  echo "  ⬚  OPENCLAW_PRIMARY_MODEL  → not set"
fi

if [ -n "$XMTP_ENV" ]; then
  echo "  ✅ XMTP_ENV               → $XMTP_ENV"
else
  echo "  ⬚  XMTP_ENV               → not set"
fi

# ── Services ──────────────────────────────────────────────────────────────
echo ""
echo "  ── services ──────────────────"
[ -n "$OPENROUTER_API_KEY" ] && echo "  ✅ OPENROUTER_API_KEY      → set" || echo "  ⬚  OPENROUTER_API_KEY      → not set"
if [ -n "$POOL_URL" ] && [ -n "$INSTANCE_ID" ]; then
  echo "  ✅ email/sms              → proxied via pool"
else
  [ -n "$AGENTMAIL_API_KEY" ] && echo "  ✅ AGENTMAIL_API_KEY       → set" || echo "  ⬚  AGENTMAIL_API_KEY       → not set"
  [ -n "$AGENTMAIL_INBOX_ID" ] && echo "  ✅ AGENTMAIL_INBOX_ID      → $AGENTMAIL_INBOX_ID" || echo "  ⬚  AGENTMAIL_INBOX_ID      → not set"
  [ -n "$TELNYX_API_KEY" ] && echo "  ✅ TELNYX_API_KEY          → set" || echo "  ⬚  TELNYX_API_KEY          → not set"
  [ -n "$TELNYX_PHONE_NUMBER" ] && echo "  ✅ TELNYX_PHONE_NUMBER     → $TELNYX_PHONE_NUMBER" || echo "  ⬚  TELNYX_PHONE_NUMBER     → not set"
fi
[ -n "$BANKR_API_KEY" ] && echo "  ✅ BANKR_API_KEY           → set" || echo "  ⬚  BANKR_API_KEY           → not set"

# ── Write .env ─────────────────────────────────────────────────────────────

# Skip .env rewrite when running locally — only rewrite on Railway where
# env vars are injected by the platform and need to be synced to the file.
if [ -n "$RAILWAY_ENVIRONMENT" ]; then
  key="${OPENROUTER_API_KEY:-}"
  agentmail_inbox="${AGENTMAIL_INBOX_ID:-}"
  telnyx_phone="${TELNYX_PHONE_NUMBER:-}"
  pool_url="${POOL_URL:-}"
  instance_id="${INSTANCE_ID:-}"

  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -v '^OPENROUTER_API_KEY=' "$ENV_FILE" 2>/dev/null | grep -v '^OPENCLAW_GATEWAY_TOKEN=' | grep -v '^AGENTMAIL_INBOX_ID=' | grep -v '^TELNYX_PHONE_NUMBER=' | grep -v '^POOL_URL=' | grep -v '^INSTANCE_ID=' > "$tmp" || true
  echo "OPENCLAW_GATEWAY_TOKEN=$gateway_token" >> "$tmp"
  if [ -n "$key" ]; then echo "OPENROUTER_API_KEY=$key" >> "$tmp"; fi
  if [ -n "$agentmail_inbox" ]; then echo "AGENTMAIL_INBOX_ID=$agentmail_inbox" >> "$tmp"; fi
  if [ -n "$telnyx_phone" ]; then echo "TELNYX_PHONE_NUMBER=$telnyx_phone" >> "$tmp"; fi
  if [ -n "$pool_url" ]; then echo "POOL_URL=$pool_url" >> "$tmp"; fi
  if [ -n "$instance_id" ]; then echo "INSTANCE_ID=$instance_id" >> "$tmp"; fi
  mv "$tmp" "$ENV_FILE"

  echo ""
  echo "  📝 Written to .env"
  echo ""
else
  echo ""
  echo "  📝 .env → kept as-is (local mode)"
  echo ""
fi
