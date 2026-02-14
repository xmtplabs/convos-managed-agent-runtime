#!/bin/sh
# Derive state paths from ROOT. Source after setting ROOT (or use init.sh).
# Sets: STATE_DIR, WORKSPACE_DIR, SKILLS_DIR, CONFIG
STATE_DIR="${ROOT:?}/.openclaw"
WORKSPACE_DIR="$STATE_DIR/workspace"
SKILLS_DIR="$STATE_DIR/skills"
CONFIG="$STATE_DIR/openclaw.json"
