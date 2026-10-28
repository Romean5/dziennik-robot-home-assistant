#!/bin/sh
set -eu

export DZIENNIK_TRANSLATOR_URL="http://127.0.0.1:8787"
/opt/dziennik-venv/bin/python /app/translation/server.py &
translator_pid=$!
node --experimental-loader=./portable/cloudflare-loader.mjs node_modules/vinext/dist/cli.js start --hostname 0.0.0.0 --port "${PORT:-3000}" &
app_pid=$!
stop_services() {
  kill "$app_pid" "$translator_pid" 2>/dev/null || true
  wait "$app_pid" "$translator_pid" 2>/dev/null || true
}
trap stop_services INT TERM
wait "$app_pid"
