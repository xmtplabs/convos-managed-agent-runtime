#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/env-load.sh"

DIR="$ROOT/scripts/skill-setup"
for f in "$DIR"/*.sh; do
  [ -f "$f" ] && [ -x "$f" ] && . "$f"
done
