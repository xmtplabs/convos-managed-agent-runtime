#!/bin/sh
# Resolve CONVOS_PLATFORM_DIR, HARNESS_DIR, and backward-compat aliases.
# Requires: ROOT must be set before sourcing.

# ── Convos platform (agent instructions, skills, web-tools) ─────────────
if [ -d "$ROOT/../convos-platform" ]; then
  CONVOS_PLATFORM_DIR="$ROOT/../convos-platform"
elif [ -d "/app/convos-platform" ]; then
  CONVOS_PLATFORM_DIR="/app/convos-platform"
else
  CONVOS_PLATFORM_DIR=""
fi

# ── Harness (boot helpers, shared scripts) ───────────────────────────────
if [ -d "$ROOT/../harness" ]; then
  HARNESS_DIR="$ROOT/../harness"
elif [ -d "/app/harness" ]; then
  HARNESS_DIR="/app/harness"
else
  HARNESS_DIR=""
fi

# ── Backward-compat aliases (used by existing scripts) ──────────────────
SHARED_WORKSPACE_DIR="$CONVOS_PLATFORM_DIR"
SHARED_SCRIPTS_DIR="$HARNESS_DIR"
