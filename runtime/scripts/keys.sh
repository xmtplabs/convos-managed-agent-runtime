#!/bin/sh
# Provision keys. Three modes:
#   1. Pool-managed: all keys arrive as env vars (nothing to do, just write .env)
#   2. Local dev with services: calls POST /provision-local to get keys from services API
#   3. Standalone: generates secrets locally, no external tools provisioned
set -e

. "$(dirname "$0")/lib/init.sh"
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE" 2>/dev/null || true; set +a; fi

echo ""
echo "  🔑 Provisioning keys"
echo "  ═══════════════════"

# ── Provision tools via services API if available and keys are missing ──────

if [ -n "$SERVICES_URL" ] && [ -n "$SERVICES_API_KEY" ]; then
  # Build the tools list based on what's missing
  tools=""
  if [ -z "$OPENROUTER_API_KEY" ]; then tools="$tools\"openrouter\","; fi
  if [ -z "$AGENTMAIL_INBOX_ID" ]; then tools="$tools\"agentmail\","; fi
  if [ -z "$TELNYX_PHONE_NUMBER" ] && [ -n "$TELNYX_API_KEY" ]; then tools="$tools\"telnyx\","; fi

  if [ -n "$tools" ]; then
    # Strip trailing comma, wrap in array
    tools_json="[$(echo "$tools" | sed 's/,$//')]"
    echo "  🔧 Requesting tools from services: $tools_json"

    resp=$(curl -s -w '\n%{http_code}' -X POST "$SERVICES_URL/provision-local" \
      -H "Authorization: Bearer $SERVICES_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"tools\": $tools_json}")
    http_code=$(echo "$resp" | tail -n1)
    body=$(echo "$resp" | sed '$d')

    if [ "$http_code" = "200" ]; then
      # Extract env vars from response
      or_key=$(echo "$body" | jq -r '.env.OPENROUTER_API_KEY // empty')
      inbox_id=$(echo "$body" | jq -r '.env.AGENTMAIL_INBOX_ID // empty')
      telnyx_num=$(echo "$body" | jq -r '.env.TELNYX_PHONE_NUMBER // empty')
      telnyx_prof=$(echo "$body" | jq -r '.env.TELNYX_MESSAGING_PROFILE_ID // empty')

      if [ -n "$or_key" ]; then
        export OPENROUTER_API_KEY="$or_key"
        echo "  🔧 OPENROUTER_API_KEY      → provisioned via services"
      fi
      if [ -n "$inbox_id" ]; then
        export AGENTMAIL_INBOX_ID="$inbox_id"
        echo "  🔧 AGENTMAIL_INBOX_ID      → provisioned via services"
      fi
      if [ -n "$telnyx_num" ]; then
        export TELNYX_PHONE_NUMBER="$telnyx_num"
        echo "  🔧 TELNYX_PHONE_NUMBER     → provisioned via services"
      fi
      if [ -n "$telnyx_prof" ]; then
        export TELNYX_MESSAGING_PROFILE_ID="$telnyx_prof"
        echo "  🔧 TELNYX_MESSAGING_PROFILE_ID → provisioned via services"
      fi
    else
      echo "  ⚠️  Services provisioning failed (http=$http_code): $body" >&2
    fi
  else
    echo "  ✅ All tool keys present in env"
  fi
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
