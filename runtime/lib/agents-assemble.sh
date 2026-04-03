#!/bin/sh
# Assemble a markdown file from a manifest + context files.
# Usage: assemble_agents <platform_dir> <runtime_name> <output_path> [manifest_name]
#
# Reads the manifest (default: AGENTS.md) from platform_dir, replaces each
# <!-- SECTION:NAME --> marker with context/NAME.md (shared) +
# context/<runtime>/NAME.md. Missing files silently skipped; empty markers removed.

assemble_agents() {
  _platform_dir="$1"
  _runtime="$2"
  _out="$3"
  _manifest_name="${4:-AGENTS.md}"

  _manifest="$_platform_dir/$_manifest_name"
  if [ ! -f "$_manifest" ]; then
    echo "⚠ $_manifest_name not found at $_manifest" >&2
    return 1
  fi

  # Start with the manifest
  _tmp_out="$_out.tmp"
  cp "$_manifest" "$_tmp_out"

  # Extract section names from markers
  _sections=$(grep -o '<!-- SECTION:[A-Z_-]* -->' "$_manifest" | sed 's/<!-- SECTION://;s/ -->//')

  for _name in $_sections; do
    _shared="$_platform_dir/context/$_name.md"
    _runtime_ctx="$_platform_dir/context/$_runtime/$_name.md"
    _content=""

    # Append shared context if it exists
    if [ -f "$_shared" ]; then
      _content=$(cat "$_shared")
    fi

    # Append runtime-specific context if it exists
    if [ -f "$_runtime_ctx" ]; then
      if [ -n "$_content" ]; then
        _content="$_content
$(cat "$_runtime_ctx")"
      else
        _content=$(cat "$_runtime_ctx")
      fi
    fi

    # Replace the marker line with content (or remove it)
    _marker="<!-- SECTION:$_name -->"
    if [ -n "$_content" ]; then
      # Write content to a temp file for sed replacement
      _content_file=$(mktemp)
      printf '%s\n' "$_content" > "$_content_file"
      # Use awk for reliable multi-line replacement
      awk -v marker="$_marker" -v cfile="$_content_file" '
        $0 == marker { while ((getline line < cfile) > 0) print line; next }
        { print }
      ' "$_tmp_out" > "$_tmp_out.2"
      mv "$_tmp_out.2" "$_tmp_out"
      rm -f "$_content_file"
    else
      # Remove the marker line entirely
      grep -v "^${_marker}$" "$_tmp_out" > "$_tmp_out.2"
      mv "$_tmp_out.2" "$_tmp_out"
    fi
  done

  mv "$_tmp_out" "$_out"
  brand_ok "$_manifest_name" "assembled (context + $_runtime)"
}
