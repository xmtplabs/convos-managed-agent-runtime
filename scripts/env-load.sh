#!/bin/sh
# Source this so env vars load in the caller's shell: . scripts/env-load.sh
# Ensures .env exists, then sources it.
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
EXAMPLE="$ROOT/env.example"
if [ ! -f "$ENV_FILE" ] && [ -f "$EXAMPLE" ]; then
  cp "$EXAMPLE" "$ENV_FILE"
  echo "[agent] Created .env from env.example"
fi
if [ -f "$ROOT/.env" ]; then
  set -a
  . "$ROOT/.env" 2>/dev/null || true
  set +a
  vars="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env" 2>/dev/null | cut -d= -f1 | tr '\n' ', ' | sed 's/, $//')"
  echo "[agent] Loaded .env: ${vars:-none}"
fi
