#!/bin/bash
# Cancel a running Bankr job
# Usage: bankr-cancel.sh <job_id>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Config: env vars or skill dir config.json
if [ -n "${BANKR_API_KEY:-}" ]; then
    API_KEY="$BANKR_API_KEY"
    API_URL="${BANKR_API_URL:-https://api.bankr.bot}"
elif [ -f "$SKILL_DIR/config.json" ]; then
    API_KEY=$(jq -r '.apiKey // empty' "$SKILL_DIR/config.json")
    API_URL=$(jq -r '.apiUrl // "https://api.bankr.bot"' "$SKILL_DIR/config.json")
else
    echo "{\"error\": \"Set BANKR_API_KEY or create $SKILL_DIR/config.json\"}" >&2
    exit 1
fi

if [ -z "$API_KEY" ]; then
    echo "{\"error\": \"apiKey not set in config.json\"}" >&2
    exit 1
fi

# Get job ID
JOB_ID="$1"

if [ -z "$JOB_ID" ]; then
    echo "{\"error\": \"Usage: $0 <job_id>\"}" >&2
    exit 1
fi

# Cancel job
curl -sf -X POST "${API_URL}/agent/job/${JOB_ID}/cancel" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  || {
    echo "{\"error\": \"Failed to cancel job\"}" >&2
    exit 1
  }
