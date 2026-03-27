#!/bin/sh
# Assemble AGENTS.md from shared template + runtime-specific section files.
# Usage: assemble_agents <shared_workspace_dir> <runtime_workspace_dir> <output_path> <runtime_label>
#
# The shared AGENTS.md contains <!-- SECTION:name --> markers.
# Each marker is replaced with the contents of <runtime_workspace_dir>/name.md.
# Missing section files cause the marker line to be silently removed.

assemble_agents() {
  _shared_dir="$1"
  _workspace_dir="$2"
  _out="$3"
  _label="${4:-runtime}"

  cp "$_shared_dir/AGENTS.md" "$_out"

  # Extract marker names and replace each with its section file
  for _marker in $(grep -oE 'SECTION:[a-zA-Z-]+' "$_out" | sed 's/SECTION://' | sort -u); do
    _section_file="$_workspace_dir/${_marker}.md"
    if [ -f "$_section_file" ]; then
      # Replace the marker line with the section file contents
      awk -v marker="<!-- SECTION:${_marker} -->" -v file="$_section_file" \
        'BEGIN { while ((getline line < file) > 0) content = content (content ? "\n" : "") line }
         $0 == marker { print content; next } { print }' "$_out" > "$_out.tmp"
      mv "$_out.tmp" "$_out"
    else
      # Remove the marker line
      grep -v "<!-- SECTION:${_marker} -->" "$_out" > "$_out.tmp"
      mv "$_out.tmp" "$_out"
    fi
  done

  brand_ok "AGENTS.md" "assembled ($_label)"
}
