#!/bin/bash
# Quick test of Telnyx SMS setup

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🧪 Telnyx SMS Test"
echo "=================="
echo ""

# Check env vars
if [ -z "$TELNYX_API_KEY" ]; then
  echo "❌ TELNYX_API_KEY not set"
  exit 1
fi
echo "✓ TELNYX_API_KEY is set"

if [ -z "$TELNYX_PHONE_NUMBER" ]; then
  echo "❌ TELNYX_PHONE_NUMBER not set"
  exit 1
fi
echo "✓ TELNYX_PHONE_NUMBER is set ($TELNYX_PHONE_NUMBER)"

# Test API connectivity by checking the phone number's messaging features
echo ""
echo "Testing API connection..."
RESPONSE=$(node -e "
  fetch('https://api.telnyx.com/v2/phone_numbers/' + encodeURIComponent(process.env.TELNYX_PHONE_NUMBER) + '/messaging', {
    headers: { 'Authorization': 'Bearer ' + process.env.TELNYX_API_KEY, 'Content-Type': 'application/json' }
  }).then(r => {
    if (!r.ok) { console.log('FAIL:' + r.status); process.exit(1); }
    return r.json();
  }).then(d => {
    const sms = d.data?.features?.sms;
    console.log('OK');
    console.log('SMS domestic 2-way: ' + (sms?.domestic_two_way ? 'yes' : 'no'));
    console.log('Profile: ' + (d.data?.messaging_profile_id || 'none'));
  }).catch(e => { console.log('FAIL:' + e.message); process.exit(1); });
")

if echo "$RESPONSE" | head -1 | grep -q "^OK"; then
  echo "✓ API connection successful"
  echo "$RESPONSE" | tail -n +2 | while read line; do echo "  $line"; done
else
  echo "❌ API connection failed: $RESPONSE"
  exit 1
fi

echo ""
echo "✅ Telnyx SMS setup looks good!"
