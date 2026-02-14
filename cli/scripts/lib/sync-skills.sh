#!/bin/sh
# Replace state skills with ROOT/skills. Source after init.sh (ROOT, SKILLS_DIR set).
set -e
if [ -d "$ROOT/skills" ]; then
  rm -rf "$SKILLS_DIR"
  mkdir -p "$SKILLS_DIR"
  for d in "$ROOT/skills"/*; do
    [ -d "$d" ] || continue
    cp -r "$d" "$SKILLS_DIR/"
  done
  echo "  🎯 skills      → $SKILLS_DIR"
fi
