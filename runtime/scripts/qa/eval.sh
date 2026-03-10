#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" 2>/dev/null || true && set +a

exec npx promptfoo eval -c "$ROOT/scripts/qa/eval/promptfooconfig.yaml" "$@"
