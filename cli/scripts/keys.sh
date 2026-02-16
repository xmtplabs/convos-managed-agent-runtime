#!/bin/sh
# Write OPENROUTER_API_KEY, BANKR_API_KEY (if set), random OPENCLAW_GATEWAY_TOKEN, SETUP_PASSWORD, and PRIVATE_WALLET_KEY to repo .env.
set -e

. "$(dirname "$0")/lib/init.sh"
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE" 2>/dev/null || true; set +a; fi

gateway_token=$(openssl rand -hex 32)
setup_password=$(openssl rand -hex 16)
private_wallet_key="0x$(openssl rand -hex 32)"
echo "[keys] Generated random OPENCLAW_GATEWAY_TOKEN, SETUP_PASSWORD, PRIVATE_WALLET_KEY"

key=""
if [ -n "$OPENROUTER_MANAGEMENT_KEY" ]; then
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
    echo "[keys] Failed to create OpenRouter key (http=$http_code): $body" >&2
    exit 1
  fi
  echo "[keys] Created OpenRouter key via API"
elif [ -n "$OPENROUTER_API_KEY" ]; then
  key="$OPENROUTER_API_KEY"
  echo "[keys] Using existing OPENROUTER_API_KEY from env"
else
  echo "[keys] No OpenRouter key: set OPENROUTER_MANAGEMENT_KEY or OPENROUTER_API_KEY and re-run to add it; writing gateway token + setup password only"
fi

agentmail_inbox=""
if [ -n "$AGENTMAIL_API_KEY" ]; then
  if [ -n "$AGENTMAIL_INBOX_ID" ]; then
    agentmail_inbox="$AGENTMAIL_INBOX_ID"
    echo "[keys] Using existing AGENTMAIL_INBOX_ID from env"
  else
    echo "[keys] Provisioning AgentMail inbox..."
    inbox_username="convos-$(openssl rand -hex 4)"
    inbox_client_id="convos-agent-$(hostname -s 2>/dev/null || echo local)"
    inbox_resp=$(curl -s -X POST "https://api.agentmail.to/v0/inboxes" \
      -H "Authorization: Bearer $AGENTMAIL_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg u "$inbox_username" --arg cid "$inbox_client_id" \
        '{username: $u, display_name: "Convos Agent", client_id: $cid}')")
    agentmail_inbox=$(echo "$inbox_resp" | jq -r '.inbox_id // empty')
    if [ -z "$agentmail_inbox" ]; then
      echo "[keys] Failed to create AgentMail inbox: $inbox_resp" >&2
    else
      echo "[keys] Created AgentMail inbox: $agentmail_inbox"
    fi
  fi
else
  echo "[keys] No AgentMail key: set AGENTMAIL_API_KEY and re-run to provision an inbox"
fi

bankr_key=""
if [ -n "$BANKR_API_KEY" ]; then
  bankr_key="$BANKR_API_KEY"
  echo "[keys] Using existing BANKR_API_KEY from env"
else
  echo "[keys] No Bankr key: set BANKR_API_KEY (bk_...) and re-run to add it"
fi

telnyx_phone=""
telnyx_profile=""
if [ -n "$TELNYX_API_KEY" ]; then
  if [ -n "$TELNYX_PHONE_NUMBER" ]; then
    telnyx_phone="$TELNYX_PHONE_NUMBER"
    telnyx_profile="$TELNYX_MESSAGING_PROFILE_ID"
    echo "[keys] Using existing TELNYX_PHONE_NUMBER from env"
  else
    echo "[keys] Provisioning Telnyx phone number..."
    # Search for an available US SMS-enabled number
    search_resp=$(curl -s -g -X GET "https://api.telnyx.com/v2/available_phone_numbers?filter[country_code]=US&filter[features][]=sms&filter[limit]=1" \
      -H "Authorization: Bearer $TELNYX_API_KEY" \
      -H "Content-Type: application/json")
    avail_number=$(echo "$search_resp" | jq -r '.data[0].phone_number // empty')
    if [ -z "$avail_number" ]; then
      echo "[keys] Failed to find available Telnyx number: $search_resp" >&2
    else
      echo "[keys] Found available number: $avail_number"
      # Create a messaging profile
      profile_resp=$(curl -s -X POST "https://api.telnyx.com/v2/messaging_profiles" \
        -H "Authorization: Bearer $TELNYX_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"name":"convos-agent-sms","whitelisted_destinations":["US"]}')
      telnyx_profile=$(echo "$profile_resp" | jq -r '.data.id // empty')
      if [ -z "$telnyx_profile" ]; then
        echo "[keys] Failed to create messaging profile: $profile_resp" >&2
      else
        echo "[keys] Created messaging profile: $telnyx_profile"
        # Purchase the number
        order_resp=$(curl -s -X POST "https://api.telnyx.com/v2/number_orders" \
          -H "Authorization: Bearer $TELNYX_API_KEY" \
          -H "Content-Type: application/json" \
          -d "$(jq -n --arg num "$avail_number" --arg pid "$telnyx_profile" \
            '{phone_numbers: [{phone_number: $num}], messaging_profile_id: $pid}')")
        ordered_number=$(echo "$order_resp" | jq -r '.data.phone_numbers[0].phone_number // empty')
        if [ -z "$ordered_number" ]; then
          echo "[keys] Failed to purchase number: $order_resp" >&2
        else
          telnyx_phone="$ordered_number"
          echo "[keys] Purchased Telnyx number: $telnyx_phone"
        fi
      fi
    fi
  fi
else
  echo "[keys] No Telnyx key: set TELNYX_API_KEY and re-run to provision a phone number"
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
echo "[keys] Gateway token, setup password, private wallet key written to .env"
if [ -n "$key" ]; then echo "[keys] OpenRouter key written to .env"; fi
if [ -n "$agentmail_inbox" ]; then echo "[keys] AgentMail inbox written to .env"; fi
if [ -n "$bankr_key" ]; then echo "[keys] Bankr key written to .env"; fi
if [ -n "$telnyx_phone" ]; then echo "[keys] Telnyx phone number written to .env"; fi
