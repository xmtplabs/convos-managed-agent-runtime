#!/bin/sh
# Convos Assistants — CLI branding colors & helpers
# Source this from any script: . "$(dirname "$0")/lib/brand.sh"

# ── ANSI colors ──────────────────────────────────────────────────────────
# Minimal palette: Convos red for logo only, rest is clean monochrome
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_DIM="\033[2m"
C_RED="\033[38;2;252;79;55m"       # brand red #FC4F37 — logo only
C_WHITE="\033[38;5;255m"           # values
C_GRAY="\033[38;5;243m"            # labels, separators, muted
C_YELLOW="\033[38;5;221m"          # warnings
C_ERR="\033[38;5;196m"             # hard errors

# ── Helpers ──────────────────────────────────────────────────────────────
brand_banner() {
  _version="${1:-unknown}"
  printf "\n"
  printf "  ${C_RED}${C_BOLD}    ___  ___  _  _ __   __ ___  ___  ${C_RESET}\n"
  printf "  ${C_RED}${C_BOLD}   / __|/ _ \\\\| \\\\| |\\\\ \\\\ / // _ \\\\/ __| ${C_RESET}\n"
  printf "  ${C_RED}${C_BOLD}  | (__| (_) | .\` | \\\\ V /| (_) \\\\__ \\\\ ${C_RESET}\n"
  printf "  ${C_RED}${C_BOLD}   \\___|\\___/|_|\\_|  \\_/  \\___/|___/ ${C_RESET}\n"
  printf "  ${C_RED}     🎈 A S S I S T A N T S ${C_RESET}\n"
  printf "\n"
  printf "  ${C_GRAY}v${_version}${C_RESET}\n"
  printf "\n"
}

brand_section() {
  printf "\n"
  printf "  ${C_WHITE}${C_BOLD}$1${C_RESET}\n"
  printf "  ${C_GRAY}─────────────────────────────────────${C_RESET}\n"
}

brand_subsection() {
  printf "\n"
  printf "  ${C_GRAY}$1${C_RESET}\n"
}

brand_ok() {
  printf "  ${C_GRAY}%-26s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"
}

brand_warn() {
  printf "  ${C_YELLOW}%-26s${C_RESET} ${C_YELLOW}%s${C_RESET}\n" "$1" "$2"
}

brand_err() {
  printf "  ${C_ERR}%-26s${C_RESET} ${C_ERR}%s${C_RESET}\n" "$1" "$2"
}

brand_dim() {
  printf "  ${C_DIM}%-26s %s${C_RESET}\n" "$1" "$2"
}

brand_info() {
  printf "  ${C_GRAY}%-26s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"
}

brand_done() {
  printf "\n  ${C_WHITE}${C_BOLD}✓ $1${C_RESET}\n\n"
}

brand_kv() {
  printf "  ${C_GRAY}%-20s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"
}

# no-op kept for backwards compat — buffering removed
brand_flush() { :; }
