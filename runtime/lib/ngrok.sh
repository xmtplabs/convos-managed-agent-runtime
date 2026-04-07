#!/bin/sh
# Start ngrok tunnel in the background when RAILWAY_PUBLIC_DOMAIN is set
# and the domain looks like an ngrok domain.
# Sourced from start.sh — requires brand_* functions and PORT to be set.
# Needs: RAILWAY_PUBLIC_DOMAIN (e.g. convos-local-runtime.ngrok.app)
#         NGROK_AUTHTOKEN (set in env or ~/.ngrok2/ngrok.yml)

if [ -z "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

# Only start a tunnel for ngrok domains
case "$RAILWAY_PUBLIC_DOMAIN" in
  *.ngrok.app|*.ngrok-free.app|*.ngrok.io) ;;
  *) return 0 2>/dev/null || exit 0 ;;
esac

if ! command -v ngrok >/dev/null 2>&1; then
  brand_warn "ngrok" "RAILWAY_PUBLIC_DOMAIN is an ngrok domain but ngrok is not installed — skipping tunnel"
  return 0 2>/dev/null || exit 0
fi

_ngrok_domain="$RAILWAY_PUBLIC_DOMAIN"
_ngrok_port="${PORT:-8080}"

# Kill any existing ngrok processes
pkill -f "ngrok http" 2>/dev/null || true
sleep 1

ngrok http "$_ngrok_port" --url="$_ngrok_domain" --log=stdout --log-level=warn &
_ngrok_pid=$!

# Brief wait to check it didn't crash immediately
sleep 2
if kill -0 "$_ngrok_pid" 2>/dev/null; then
  brand_ok "ngrok" "https://$_ngrok_domain -> localhost:$_ngrok_port (pid $_ngrok_pid)"
else
  brand_warn "ngrok" "failed to start tunnel (check NGROK_AUTHTOKEN)"
fi

unset _ngrok_domain _ngrok_port _ngrok_pid
