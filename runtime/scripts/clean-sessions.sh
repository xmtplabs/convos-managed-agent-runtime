#!/bin/sh
# Manually clear all agent session files.
# Usage: pnpm clean-sessions

_sessions_dir="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/agents/main/sessions"

if [ ! -d "$_sessions_dir" ]; then
  echo "No sessions directory found at $_sessions_dir"
  exit 0
fi

_count=$(find "$_sessions_dir" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')

if [ "$_count" -eq 0 ]; then
  echo "No session files to clean"
  exit 0
fi

rm -f "$_sessions_dir"/*.jsonl "$_sessions_dir/sessions.json"
echo "Cleared $_count session file(s) from $_sessions_dir"
