#!/bin/sh
set -e

echo ""
echo "  convos-runtime-hermes"
echo "  ====================="
echo ""

# Validate required env vars
if [ -z "$OPENROUTER_API_KEY" ]; then
  echo "  ERROR: OPENROUTER_API_KEY is required but not set" >&2
  exit 1
fi

# Generate gateway token if not provided
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  export OPENCLAW_GATEWAY_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  echo "  GATEWAY_TOKEN    -> generated"
else
  echo "  GATEWAY_TOKEN    -> from env"
fi

echo "  MODEL            -> ${OPENCLAW_PRIMARY_MODEL:-openrouter/anthropic/claude-sonnet-4-6}"
echo "  XMTP_ENV         -> ${XMTP_ENV:-dev}"
echo "  PORT             -> ${PORT:-8080}"
[ -n "$POOL_URL" ] && echo "  POOL_URL         -> $POOL_URL" || echo "  POOL_URL         -> not set"
[ -n "$INSTANCE_ID" ] && echo "  INSTANCE_ID      -> $INSTANCE_ID" || echo "  INSTANCE_ID      -> not set"
echo ""

exec "$@"
