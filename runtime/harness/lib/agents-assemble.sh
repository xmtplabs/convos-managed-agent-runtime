#!/bin/sh
# Assemble AGENTS.md from template + section files.
# Usage: assemble_agents <platform_dir> <output_path> <runtime_label>
#
# Resolution order for each <!-- SECTION:NAME --> marker:
#   1. <platform_dir>/context/NAME.md              (shared content)
#   2. <platform_dir>/context/<runtime>/NAME.md     (runtime-specific, appended)
#   3. Silently removed if neither exists.

assemble_agents() {
  _platform_dir="$1"
  _out="$2"
  _label="${3:-runtime}"

  cp "$_platform_dir/AGENTS.md" "$_out"

  for _marker in $(grep -oE 'SECTION:[A-Za-z-]+' "$_out" | sed 's/SECTION://' | sort -u); do
    _shared="$_platform_dir/context/${_marker}.md"
    _runtime="$_platform_dir/context/$_label/${_marker}.md"
    _content=""

    # Shared section first
    [ -f "$_shared" ] && _content="$(cat "$_shared")"
    # Runtime-specific appended after
    if [ -f "$_runtime" ]; then
      if [ -n "$_content" ]; then
        _content="$_content

$(cat "$_runtime")"
      else
        _content="$(cat "$_runtime")"
      fi
    fi

    if [ -n "$_content" ]; then
      # Write combined content to temp file for awk
      _tmp_section="$(mktemp)"
      printf '%s\n' "$_content" > "$_tmp_section"
      awk -v marker="<!-- SECTION:${_marker} -->" -v file="$_tmp_section" \
        'BEGIN { while ((getline line < file) > 0) content = content (content ? "\n" : "") line }
         $0 == marker { print content; next } { print }' "$_out" > "$_out.tmp"
      mv "$_out.tmp" "$_out"
      rm -f "$_tmp_section"
    else
      grep -v "<!-- SECTION:${_marker} -->" "$_out" > "$_out.tmp"
      mv "$_out.tmp" "$_out"
    fi
  done

  brand_ok "AGENTS.md" "assembled ($_label)"
}
