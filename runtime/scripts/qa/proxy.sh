#!/bin/sh
# QA proxy tests — verify service proxy endpoints on the pool manager.
# Requires POOL_URL, INSTANCE_ID, and OPENCLAW_GATEWAY_TOKEN in .env.
# Tests email send/poll, SMS send/poll, and bankr via the proxy.
set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a
. "$ROOT/scripts/lib/paths.sh"
cd "$ROOT"
. "$ROOT/scripts/lib/env-load.sh"

# ── Require proxy env ──────────────────────────────────────────────────────
if [ -z "$POOL_URL" ] || [ -z "$INSTANCE_ID" ] || [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  echo "Proxy QA requires POOL_URL, INSTANCE_ID, and OPENCLAW_GATEWAY_TOKEN."
  echo "Set them in runtime/.env and re-run."
  exit 1
fi

AUTH="Bearer ${INSTANCE_ID}:${OPENCLAW_GATEWAY_TOKEN}"
FAILED=""
QA_TMP=$(mktemp)

pass() { echo "  [PASS] $1"; }
fail() { echo "  [FAIL] $1 -- $2" >&2; FAILED="${FAILED} $1"; }

echo ""
echo "  Pool URL:    $POOL_URL"
echo "  Instance:    $INSTANCE_ID"
echo ""

# --- Email send (proxy) ---
echo "=== QA proxy: email-send ==="
echo "  > POST /api/proxy/email/send"
STATUS=$(curl -s -o "$QA_TMP" -w "%{http_code}" \
  -X POST "${POOL_URL}/api/proxy/email/send" \
  -H "Authorization: $AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"to\":\"fabri@xmtp.com\",\"subject\":\"QA proxy $(date +%s)\",\"text\":\"Proxy smoke test\"}")
if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 300 ]; then
  pass "email-send (HTTP $STATUS)"
else
  fail "email-send" "HTTP $STATUS: $(cat "$QA_TMP")"
fi

# --- Email poll (proxy) ---
echo ""
echo "=== QA proxy: email-poll ==="
echo "  > GET /api/proxy/email/messages?limit=1"
STATUS=$(curl -s -o "$QA_TMP" -w "%{http_code}" \
  "${POOL_URL}/api/proxy/email/messages?limit=1" \
  -H "Authorization: $AUTH")
if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 300 ]; then
  # Show first message subject if present
  SUBJ=$(cat "$QA_TMP" | grep -o '"subject":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$SUBJ" ] && echo "  Latest: $SUBJ"
  pass "email-poll (HTTP $STATUS)"
else
  fail "email-poll" "HTTP $STATUS: $(cat "$QA_TMP")"
fi

# --- Email threads (proxy) ---
echo ""
echo "=== QA proxy: email-threads ==="
echo "  > GET /api/proxy/email/threads"
STATUS=$(curl -s -o "$QA_TMP" -w "%{http_code}" \
  "${POOL_URL}/api/proxy/email/threads" \
  -H "Authorization: $AUTH")
if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 300 ]; then
  pass "email-threads (HTTP $STATUS)"
else
  fail "email-threads" "HTTP $STATUS: $(cat "$QA_TMP")"
fi

# --- SMS send (proxy) ---
echo ""
echo "=== QA proxy: sms-send ==="
echo "  > POST /api/proxy/sms/send"
STATUS=$(curl -s -o "$QA_TMP" -w "%{http_code}" \
  -X POST "${POOL_URL}/api/proxy/sms/send" \
  -H "Authorization: $AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"to\":\"+16154376139\",\"text\":\"QA proxy $(date +%s)\"}")
if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 300 ]; then
  MSG_ID=$(cat "$QA_TMP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$MSG_ID" ] && echo "  Message ID: $MSG_ID"
  pass "sms-send (HTTP $STATUS)"
else
  fail "sms-send" "HTTP $STATUS: $(cat "$QA_TMP")"
fi

# --- SMS poll (proxy) ---
echo ""
echo "=== QA proxy: sms-poll ==="
echo "  > GET /api/proxy/sms/records"
STATUS=$(curl -s -o "$QA_TMP" -w "%{http_code}" \
  "${POOL_URL}/api/proxy/sms/records?filter%5Brecord_type%5D=message&filter%5Bdirection%5D=inbound&page%5Bsize%5D=1" \
  -H "Authorization: $AUTH")
if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 300 ]; then
  pass "sms-poll (HTTP $STATUS)"
else
  fail "sms-poll" "HTTP $STATUS: $(cat "$QA_TMP")"
fi

# --- Bankr (proxy) ---
echo ""
echo "=== QA proxy: bankr ==="
echo "  > GET /api/proxy/bankr/agent/wallets"
STATUS=$(curl -s -o "$QA_TMP" -w "%{http_code}" \
  "${POOL_URL}/api/proxy/bankr/agent/wallets" \
  -H "Authorization: $AUTH")
if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 300 ]; then
  pass "bankr (HTTP $STATUS)"
elif [ "$STATUS" = "503" ]; then
  echo "  [SKIP] bankr not configured on pool"
else
  fail "bankr" "HTTP $STATUS: $(cat "$QA_TMP")"
fi

rm -f "$QA_TMP"

# --- Summary ---
echo ""
if [ -n "$FAILED" ]; then
  echo "FAILED:$FAILED"
  exit 1
fi
echo "All proxy tests passed"
