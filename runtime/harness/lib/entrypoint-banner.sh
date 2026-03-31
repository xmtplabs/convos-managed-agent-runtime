#!/bin/sh
# Shared entrypoint banner — prints version + ASCII art before boot.

_ent_dir="$(dirname "$0")"
if [ -d "/app/platform-scripts" ]; then
  . /app/platform-scripts/brand.sh
  brand_resolve_version /app/runtime-version.json
else
  . "$_ent_dir/../lib/brand.sh"
  brand_resolve_version "$_ent_dir/../../package.json" "$_ent_dir/../runtime-version.json" "$_ent_dir/../package.json"
fi
brand_banner "$_BRAND_VERSION"
unset _ent_dir
