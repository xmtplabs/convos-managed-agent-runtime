#!/bin/sh
# Substitute .env vars into config template and write to OpenClaw config.
# Requires: ROOT, CONFIG_DEFAULTS, CONFIG (or TEMPLATE_PATH, ENV_FILE, CONFIG_OUTPUT)
set -e
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CONFIG_DEFAULTS="${CONFIG_DEFAULTS:-$ROOT/config}"
CONFIG="${CONFIG:-${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/openclaw.json}"
TEMPLATE_PATH="${TEMPLATE_PATH:-$CONFIG_DEFAULTS/openclaw.json}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
CONFIG_OUTPUT="${CONFIG_OUTPUT:-$CONFIG}"
export TEMPLATE_PATH ENV_FILE CONFIG_OUTPUT
node "$ROOT/scripts/apply-env-to-config.cjs"
