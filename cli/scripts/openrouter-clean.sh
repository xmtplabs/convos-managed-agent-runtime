#!/bin/sh
# Delete ALL OpenRouter API keys via the management API. Clean slate.
set -e

. "$(dirname "$0")/lib/init.sh"
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE" 2>/dev/null || true; set +a; fi

if [ -z "$OPENROUTER_MANAGEMENT_KEY" ]; then
  echo "[openrouter-clean] OPENROUTER_MANAGEMENT_KEY is not set. Cannot continue." >&2
  exit 1
fi

echo "[openrouter-clean] Fetching all OpenRouter keys..."

resp=$(curl -s -w '\n%{http_code}' -X GET "https://openrouter.ai/api/v1/keys" \
  -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY")
http_code=$(echo "$resp" | tail -n1)
body=$(echo "$resp" | sed '$d')

if [ "$http_code" != "200" ]; then
  echo "[openrouter-clean] Failed to list keys (http=$http_code): $body" >&2
  exit 1
fi

keys=$(echo "$body" | jq -r '.data // []')
count=$(echo "$keys" | jq 'length')

if [ "$count" = "0" ]; then
  echo "[openrouter-clean] No keys found. Already clean."
  exit 0
fi

echo "[openrouter-clean] Found $count key(s). Deleting all..."

deleted=0
failed=0
SKIP_KEY_NAME="${OPENROUTER_CLEAN_SKIP_NAME:-dont touch}"
echo "$keys" | jq -c '.[]' | while read -r entry; do
  hash=$(echo "$entry" | jq -r '.hash // empty')
  name=$(echo "$entry" | jq -r '.name // "unnamed"')
  if [ -z "$hash" ]; then
    echo "  [skip] Key '$name' has no hash"
    continue
  fi
  if [ "$name" = "$SKIP_KEY_NAME" ]; then
    echo "  [skip] Key '$name' (preserved)"
    continue
  fi

  del_resp=$(curl -s -w '\n%{http_code}' -X DELETE "https://openrouter.ai/api/v1/keys/$hash" \
    -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY")
  del_code=$(echo "$del_resp" | tail -n1)

  if [ "$del_code" = "200" ] || [ "$del_code" = "204" ]; then
    echo "  [deleted] $name (hash=$hash)"
  else
    del_body=$(echo "$del_resp" | sed '$d')
    echo "  [failed] $name (hash=$hash) http=$del_code $del_body" >&2
  fi
done

# Remove OPENROUTER_API_KEY from .env
if [ -f "$ENV_FILE" ]; then
  tmp=$(mktemp)
  grep -v '^OPENROUTER_API_KEY=' "$ENV_FILE" > "$tmp" || true
  mv "$tmp" "$ENV_FILE"
  echo "[openrouter-clean] Removed OPENROUTER_API_KEY from .env"
fi

echo "[openrouter-clean] Done. All OpenRouter keys deleted."
