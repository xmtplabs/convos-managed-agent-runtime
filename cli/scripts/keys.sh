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

bankr_key=""
if [ -n "$BANKR_API_KEY" ]; then
  bankr_key="$BANKR_API_KEY"
  echo "[keys] Using existing BANKR_API_KEY from env"
else
  echo "[keys] No Bankr key: set BANKR_API_KEY (bk_...) and re-run to add it"
fi

touch "$ENV_FILE"
tmp=$(mktemp)
grep -v '^OPENROUTER_API_KEY=' "$ENV_FILE" 2>/dev/null | grep -v '^BANKR_API_KEY=' | grep -v '^OPENCLAW_GATEWAY_TOKEN=' | grep -v '^SETUP_PASSWORD=' | grep -v '^PRIVATE_WALLET_KEY=' > "$tmp" || true
echo "OPENCLAW_GATEWAY_TOKEN=$gateway_token" >> "$tmp"
echo "SETUP_PASSWORD=$setup_password" >> "$tmp"
echo "PRIVATE_WALLET_KEY=$private_wallet_key" >> "$tmp"
if [ -n "$key" ]; then echo "OPENROUTER_API_KEY=$key" >> "$tmp"; fi
if [ -n "$bankr_key" ]; then echo "BANKR_API_KEY=$bankr_key" >> "$tmp"; fi
mv "$tmp" "$ENV_FILE"
echo "[keys] Gateway token, setup password, private wallet key written to .env"
if [ -n "$key" ]; then echo "[keys] OpenRouter key written to .env"; fi
if [ -n "$bankr_key" ]; then echo "[keys] Bankr key written to .env"; fi
