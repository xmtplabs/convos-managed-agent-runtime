#!/bin/sh
# Shared entrypoint banner — prints version + ASCII art before boot.

_ent_dir="$(dirname "$0")"
_ent_lib=""
[ -d "$_ent_dir/../lib" ] && _ent_lib="$_ent_dir/../lib"
[ -z "$_ent_lib" ] && [ -d "/app/platform-scripts" ] && _ent_lib="/app/platform-scripts"
if [ -n "$_ent_lib" ] && [ -f "$_ent_lib/brand.sh" ]; then
  . "$_ent_lib/brand.sh"
fi

brand_resolve_version "$_ent_dir/../../package.json" "$_ent_dir/../runtime-version.json" "$_ent_dir/../package.json"
brand_banner "$_BRAND_VERSION"
unset _ent_dir _ent_lib
