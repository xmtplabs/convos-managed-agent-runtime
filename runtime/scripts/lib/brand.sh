#!/bin/sh
# Convos Assistants — CLI branding colors & helpers
# Source this from any script: . "$(dirname "$0")/lib/brand.sh"
#
# On Railway, rapid individual printf calls get reordered by the log
# collector. All brand_* functions write to a temp buffer file; call
# brand_flush at the end of each script to emit everything as one block.

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
# Each script gets its own buffer so concurrent-looking Railway logs stay grouped.
_BRAND_BUF="${TMPDIR:-/tmp}/.brand-buf-$$"
: > "$_BRAND_BUF"

_brand_print() {
  printf "$@" >> "$_BRAND_BUF"
}

brand_flush() {
  # Emit buffered output as one write, then reset.
  cat "$_BRAND_BUF" 2>/dev/null
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
  # Usage: brand_section "title"
  _brand_print "\n"
  _brand_print "  ${C_WHITE}${C_BOLD}$1${C_RESET}\n"
  _brand_print "  ${C_GRAY}─────────────────────────────────────${C_RESET}\n"
}

brand_subsection() {
  # Usage: brand_subsection "label"
  _brand_print "\n"
  _brand_print "  ${C_GRAY}$1${C_RESET}\n"
}

brand_ok() {
  # Usage: brand_ok "LABEL" "value"
  _brand_print "  ${C_GRAY}%-26s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"
}

brand_warn() {
  # Usage: brand_warn "LABEL" "value"
  _brand_print "  ${C_YELLOW}%-26s${C_RESET} ${C_YELLOW}%s${C_RESET}\n" "$1" "$2"
}

brand_err() {
  # Usage: brand_err "LABEL" "value"
  _brand_print "  ${C_ERR}%-26s${C_RESET} ${C_ERR}%s${C_RESET}\n" "$1" "$2"
}

brand_dim() {
  # Usage: brand_dim "LABEL" "value"
  _brand_print "  ${C_DIM}%-26s %s${C_RESET}\n" "$1" "$2"
}

brand_info() {
  # Usage: brand_info "LABEL" "value"
  _brand_print "  ${C_GRAY}%-26s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"
}

brand_done() {
  # Usage: brand_done "message"
  _brand_print "\n  ${C_WHITE}${C_BOLD}✓ $1${C_RESET}\n\n"
}

brand_kv() {
  # Usage: brand_kv "LABEL" "value"
  _brand_print "  ${C_GRAY}%-20s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"
}
