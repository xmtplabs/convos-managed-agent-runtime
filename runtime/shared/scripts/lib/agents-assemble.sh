#!/bin/sh
# Assemble AGENTS.md from base + runtime extra.
# Usage: assemble_agents <shared_workspace_dir> <extra_md_path> <output_path> <runtime_label>

assemble_agents() {
  _shared_dir="$1"
  _extra="$2"
  _out="$3"
  _label="${4:-runtime}"

  cp "$_shared_dir/AGENTS-base.md" "$_out"
  [ -f "$_extra" ] && cat "$_extra" >> "$_out"
  brand_ok "AGENTS.md" "assembled (shared + $_label)"
}
