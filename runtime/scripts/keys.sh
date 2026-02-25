#!/bin/sh
# Write OPENROUTER_API_KEY, BANKR_API_KEY (if set), random OPENCLAW_GATEWAY_TOKEN, SETUP_PASSWORD, and PRIVATE_WALLET_KEY to repo .env.
set -e

. "$(dirname "$0")/lib/init.sh"
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE" 2>/dev/null || true; set +a; fi

echo ""
echo "  🔑 Provisioning keys"
echo "  ═══════════════════"

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

key=""
if [ -n "$OPENROUTER_API_KEY" ]; then
  key="$OPENROUTER_API_KEY"
  echo "  ✅ OPENROUTER_API_KEY      → from env"
elif [ -n "$OPENROUTER_MANAGEMENT_KEY" ]; then
  name="convos-local-$(date +%s)"
  limit="${OPENROUTER_KEY_LIMIT:-20}"
  limit_reset="${OPENROUTER_KEY_LIMIT_RESET:-monthly}"
  payload=$(jq -n --arg name "$name" --arg limit "$limit" --arg limit_reset "$limit_reset" \
    '{name: $name, limit: ($limit | tonumber), limit_reset: $limit_reset}')
  resp=$(curl -s -w '\n%{http_code}' -X POST "https://openrouter.ai/api/v1/keys" \
    -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload")
  http_code=$(echo "$resp" | tail -n1)
  body=$(echo "$resp" | sed '$d')
  key=$(echo "$body" | jq -r '.key // empty')
  if [ -z "$key" ] || [ "$key" = "null" ]; then
    echo "  ❌ OPENROUTER_API_KEY      → failed to create (http=$http_code): $body" >&2
    exit 1
  fi
  echo "  🔧 OPENROUTER_API_KEY      → created via management key"
else
  echo "  ⬚  OPENROUTER_API_KEY      → not set"
fi

agentmail_inbox=""
if [ -n "$AGENTMAIL_API_KEY" ]; then
  echo "  ✅ AGENTMAIL_API_KEY       → from env"
  if [ -n "$AGENTMAIL_INBOX_ID" ]; then
    agentmail_inbox="$AGENTMAIL_INBOX_ID"
    echo "  ✅ AGENTMAIL_INBOX_ID      → from env"
  else
    echo "  🔧 AGENTMAIL_INBOX_ID      → provisioning..."
    inbox_username="convos-$(openssl rand -hex 4)"
    inbox_client_id="convos-agent-$(hostname -s 2>/dev/null || echo local)"
    inbox_payload=$(jq -n --arg u "$inbox_username" --arg cid "$inbox_client_id" --arg dom "${AGENTMAIL_DOMAIN:-}" \
        '{username: $u, display_name: "Convos Agent", client_id: $cid} + (if ($dom | length) > 0 then {domain: $dom} else {} end)')
    inbox_resp=$(curl -s -X POST "https://api.agentmail.to/v0/inboxes" \
      -H "Authorization: Bearer $AGENTMAIL_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$inbox_payload")
    agentmail_inbox=$(echo "$inbox_resp" | jq -r '.inbox_id // empty')
    if [ -z "$agentmail_inbox" ]; then
      echo "  ❌ AGENTMAIL_INBOX_ID      → failed: $inbox_resp" >&2
    else
      echo "  🔧 AGENTMAIL_INBOX_ID      → created: $agentmail_inbox"
    fi
  fi
else
  echo "  ⬚  AGENTMAIL_API_KEY       → not set"
fi

bankr_key=""
if [ -n "$BANKR_API_KEY" ]; then
  bankr_key="$BANKR_API_KEY"
  echo "  ✅ BANKR_API_KEY           → from env"
else
  echo "  ⬚  BANKR_API_KEY           → not set"
fi

telnyx_phone=""
telnyx_profile=""
if [ -n "$TELNYX_API_KEY" ]; then
  echo "  ✅ TELNYX_API_KEY          → from env"
  if [ -n "$TELNYX_PHONE_NUMBER" ]; then
    telnyx_phone="$TELNYX_PHONE_NUMBER"
    telnyx_profile="$TELNYX_MESSAGING_PROFILE_ID"
    echo "  ✅ TELNYX_PHONE_NUMBER     → from env"
    if [ -n "$telnyx_profile" ]; then
      echo "  ✅ TELNYX_MESSAGING_PROFILE_ID → from env"
    else
      echo "  ⬚  TELNYX_MESSAGING_PROFILE_ID → not set"
    fi
  else
    echo "  🔧 TELNYX_PHONE_NUMBER     → provisioning..."
    # Search for an available US SMS-enabled number
    search_resp=$(curl -s -g -X GET "https://api.telnyx.com/v2/available_phone_numbers?filter[country_code]=US&filter[features][]=sms&filter[limit]=1" \
      -H "Authorization: Bearer $TELNYX_API_KEY" \
      -H "Content-Type: application/json")
    avail_number=$(echo "$search_resp" | jq -r '.data[0].phone_number // empty')
    if [ -z "$avail_number" ]; then
      echo "  ❌ TELNYX_PHONE_NUMBER     → no numbers available: $search_resp" >&2
    else
      # Purchase the number first (no profile yet)
      order_resp=$(curl -s -X POST "https://api.telnyx.com/v2/number_orders" \
        -H "Authorization: Bearer $TELNYX_API_KEY" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg num "$avail_number" \
          '{phone_numbers: [{phone_number: $num}]}')")
      ordered_number=$(echo "$order_resp" | jq -r '.data.phone_numbers[0].phone_number // empty')
      if [ -z "$ordered_number" ]; then
        echo "  ❌ TELNYX_PHONE_NUMBER     → failed to purchase: $order_resp" >&2
      else
        telnyx_phone="$ordered_number"
        echo "  🔧 TELNYX_PHONE_NUMBER     → purchased: $telnyx_phone"
        # Reuse existing messaging profile (env → API lookup → create)
        if [ -n "$TELNYX_MESSAGING_PROFILE_ID" ]; then
          telnyx_profile="$TELNYX_MESSAGING_PROFILE_ID"
        else
          existing_profile=$(curl -s -X GET "https://api.telnyx.com/v2/messaging_profiles?page[size]=1" \
            -H "Authorization: Bearer $TELNYX_API_KEY" \
            -H "Content-Type: application/json" | jq -r '.data[0].id // empty')
          if [ -n "$existing_profile" ]; then
            telnyx_profile="$existing_profile"
          else
            profile_resp=$(curl -s -X POST "https://api.telnyx.com/v2/messaging_profiles" \
              -H "Authorization: Bearer $TELNYX_API_KEY" \
              -H "Content-Type: application/json" \
              -d '{"name":"convos-sms","whitelisted_destinations":["US"]}')
            telnyx_profile=$(echo "$profile_resp" | jq -r '.data.id // empty')
            if [ -z "$telnyx_profile" ]; then
              echo "  ❌ TELNYX_MESSAGING_PROFILE → failed: $profile_resp" >&2
            fi
          fi
        fi
        # Assign the number to the messaging profile
        if [ -n "$telnyx_profile" ]; then
          curl -s -X PATCH "https://api.telnyx.com/v2/phone_numbers/$telnyx_phone" \
            -H "Authorization: Bearer $TELNYX_API_KEY" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg pid "$telnyx_profile" \
              '{messaging_profile_id: $pid}')" > /dev/null
        fi
      fi
    fi
  fi
else
  echo "  ⬚  TELNYX_API_KEY          → not set"
fi

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
