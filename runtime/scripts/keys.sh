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
[ -n "$RAILWAY_VOLUME_MOUNT_PATH" ] && echo "  📦 VOLUME                  → $RAILWAY_VOLUME_MOUNT_PATH" || echo "  ⬚  VOLUME                  → none"

# ── Hard dependency: agent needs a model key to function ───────────────────

if [ -z "$OPENROUTER_API_KEY" ]; then
  echo "  ❌ OPENROUTER_API_KEY is required but not set" >&2
  exit 1
fi

# ── Secrets: use env if set, generate locally as fallback ──────────────────

if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
  gateway_token="$OPENCLAW_GATEWAY_TOKEN"
  echo "  ✅ OPENCLAW_GATEWAY_TOKEN  → from env"
else
  gateway_token=$(openssl rand -hex 32)
  echo "  🔧 OPENCLAW_GATEWAY_TOKEN  → generated"
fi

if [ -n "$SETUP_PASSWORD" ]; then
  setup_password="$SETUP_PASSWORD"
  echo "  ✅ SETUP_PASSWORD          → from env"
else
  setup_password=$(openssl rand -hex 16)
  echo "  🔧 SETUP_PASSWORD          → generated"
fi

if [ -n "$PRIVATE_WALLET_KEY" ]; then
  private_wallet_key="$PRIVATE_WALLET_KEY"
  echo "  ✅ PRIVATE_WALLET_KEY      → from env"
else
  private_wallet_key="0x$(openssl rand -hex 32)"
  echo "  🔧 PRIVATE_WALLET_KEY      → generated"
fi

# ── Report status of remaining keys ───────────────────────────────────────

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

[ -n "$OPENROUTER_API_KEY" ] && echo "  ✅ OPENROUTER_API_KEY      → set" || echo "  ⬚  OPENROUTER_API_KEY      → not set"
[ -n "$AGENTMAIL_INBOX_ID" ] && echo "  ✅ AGENTMAIL_INBOX_ID      → $AGENTMAIL_INBOX_ID" || echo "  ⬚  AGENTMAIL_INBOX_ID      → not set"
[ -n "$BANKR_API_KEY" ] && echo "  ✅ BANKR_API_KEY           → set" || echo "  ⬚  BANKR_API_KEY           → not set"
[ -n "$TELNYX_PHONE_NUMBER" ] && echo "  ✅ TELNYX_PHONE_NUMBER     → $TELNYX_PHONE_NUMBER" || echo "  ⬚  TELNYX_PHONE_NUMBER     → not set"
[ -n "$TELNYX_MESSAGING_PROFILE_ID" ] && echo "  ✅ TELNYX_MESSAGING_PROFILE_ID → set" || echo "  ⬚  TELNYX_MESSAGING_PROFILE_ID → not set"

# ── Write .env ─────────────────────────────────────────────────────────────

key="${OPENROUTER_API_KEY:-}"
agentmail_inbox="${AGENTMAIL_INBOX_ID:-}"
bankr_key="${BANKR_API_KEY:-}"
telnyx_phone="${TELNYX_PHONE_NUMBER:-}"
telnyx_profile="${TELNYX_MESSAGING_PROFILE_ID:-}"

touch "$ENV_FILE"
tmp=$(mktemp)
grep -v '^OPENROUTER_API_KEY=' "$ENV_FILE" 2>/dev/null | grep -v '^BANKR_API_KEY=' | grep -v '^OPENCLAW_GATEWAY_TOKEN=' | grep -v '^SETUP_PASSWORD=' | grep -v '^PRIVATE_WALLET_KEY=' | grep -v '^AGENTMAIL_INBOX_ID=' | grep -v '^TELNYX_PHONE_NUMBER=' | grep -v '^TELNYX_MESSAGING_PROFILE_ID=' > "$tmp" || true
echo "OPENCLAW_GATEWAY_TOKEN=$gateway_token" >> "$tmp"
echo "SETUP_PASSWORD=$setup_password" >> "$tmp"
echo "PRIVATE_WALLET_KEY=$private_wallet_key" >> "$tmp"
if [ -n "$key" ]; then echo "OPENROUTER_API_KEY=$key" >> "$tmp"; fi
if [ -n "$agentmail_inbox" ]; then echo "AGENTMAIL_INBOX_ID=$agentmail_inbox" >> "$tmp"; fi
if [ -n "$bankr_key" ]; then echo "BANKR_API_KEY=$bankr_key" >> "$tmp"; fi
if [ -n "$telnyx_phone" ]; then echo "TELNYX_PHONE_NUMBER=$telnyx_phone" >> "$tmp"; fi
if [ -n "$telnyx_profile" ]; then echo "TELNYX_MESSAGING_PROFILE_ID=$telnyx_profile" >> "$tmp"; fi
mv "$tmp" "$ENV_FILE"

echo ""
echo "  📝 Written to .env"
echo ""
