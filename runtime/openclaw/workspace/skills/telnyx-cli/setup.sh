#!/bin/bash
# Telnyx Skill Setup — verifies env vars are set

set -e

echo "🔧 Telnyx Skill Setup"
echo "===================="
echo ""

# Check required env vars
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

# Check Node.js is available
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found"
  exit 1
fi
echo "✓ Node.js found: $(node --version)"

echo ""
echo "✨ Setup complete!"
