#!/bin/sh
# Resolve CONVOS_PLATFORM_DIR, LIB_DIR, and backward-compat aliases.
# Requires: ROOT must be set before sourcing.

# ── Convos platform (agent instructions, skills, web-tools) ─────────────
if [ -f "$ROOT/../convos-platform/AGENTS.md" ]; then
  CONVOS_PLATFORM_DIR="$ROOT/../convos-platform"
elif [ -f "/app/convos-platform/AGENTS.md" ]; then
  CONVOS_PLATFORM_DIR="/app/convos-platform"
else
  CONVOS_PLATFORM_DIR=""
fi

# ── Lib (shared boot helpers, assembly, crons) ──────────────────────────
if [ -f "$ROOT/../lib/brand.sh" ]; then
  LIB_DIR="$ROOT/../lib"
elif [ -f "/app/lib/brand.sh" ]; then
  LIB_DIR="/app/lib"
else
  LIB_DIR=""
fi

# ── Backward-compat aliases ─────────────────────────────────────────────
SHARED_WORKSPACE_DIR="$CONVOS_PLATFORM_DIR"
SHARED_SCRIPTS_DIR="$LIB_DIR"
HARNESS_DIR="$LIB_DIR"
