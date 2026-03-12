#!/bin/sh
# Convos Assistants — CLI branding colors & helpers
# Source this from any script: . "$(dirname "$0")/lib/brand.sh"
#
# On Railway, the log collector reorders lines with the same timestamp.
# All brand_* functions write to a buffer; brand_flush emits line-by-line
# with a small delay on Railway so each line gets a distinct timestamp.

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

# ── Output buffer ────────────────────────────────────────────────────────
_BRAND_BUF="${TMPDIR:-/tmp}/.brand-buf-$$"
: > "$_BRAND_BUF"

_brand_print() {
  printf "$@" >> "$_BRAND_BUF"
}

brand_flush() {
  # On Railway, emit line-by-line with 10ms gaps so each line gets a
  # distinct timestamp and the log collector preserves ordering.
  # Locally, just cat the buffer (instant).
  if [ -n "${RAILWAY_ENVIRONMENT:-}" ]; then
    while IFS= read -r _line || [ -n "$_line" ]; do
      printf '%s\n' "$_line"
      sleep 0.01
    done < "$_BRAND_BUF"
  else
    cat "$_BRAND_BUF" 2>/dev/null
  fi
  : > "$_BRAND_BUF"
}

# ── Helpers ──────────────────────────────────────────────────────────────
brand_banner() {
  _version="${1:-unknown}"
  _brand_print "\n"
  _brand_print "  ${C_RED}${C_BOLD}    ___  ___  _  _ __   __ ___  ___  ${C_RESET}\n"
  _brand_print "  ${C_RED}${C_BOLD}   / __|/ _ \\\\| \\\\| |\\\\ \\\\ / // _ \\\\/ __| ${C_RESET}\n"
  _brand_print "  ${C_RED}${C_BOLD}  | (__| (_) | .\` | \\\\ V /| (_) \\\\__ \\\\ ${C_RESET}\n"
  _brand_print "  ${C_RED}${C_BOLD}   \\___|\\___/|_|\\_|  \\_/  \\___/|___/ ${C_RESET}\n"
  _brand_print "  ${C_RED}     🎈 A S S I S T A N T S ${C_RESET}\n"
  _brand_print "\n"
  _brand_print "  ${C_GRAY}v${_version}${C_RESET}\n"
  _brand_print "\n"
}

brand_section() {
  _brand_print "\n"
  _brand_print "  ${C_WHITE}${C_BOLD}$1${C_RESET}\n"
  _brand_print "  ${C_GRAY}─────────────────────────────────────${C_RESET}\n"
}

brand_subsection() {
  _brand_print "\n"
  _brand_print "  ${C_GRAY}$1${C_RESET}\n"
}

brand_ok() {
  _brand_print "  ${C_GRAY}%-26s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"
}

brand_warn() {
  _brand_print "  ${C_YELLOW}%-26s${C_RESET} ${C_YELLOW}%s${C_RESET}\n" "$1" "$2"
}

brand_err() {
  _brand_print "  ${C_ERR}%-26s${C_RESET} ${C_ERR}%s${C_RESET}\n" "$1" "$2"
}

brand_dim() {
  _brand_print "  ${C_DIM}%-26s %s${C_RESET}\n" "$1" "$2"
}

brand_info() {
  _brand_print "  ${C_GRAY}%-26s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"
}

brand_done() {
  _brand_print "\n  ${C_WHITE}${C_BOLD}✓ $1${C_RESET}\n\n"
}

brand_kv() {
  _brand_print "  ${C_GRAY}%-20s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"
}
