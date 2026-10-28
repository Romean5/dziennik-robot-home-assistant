#!/bin/sh
set -eu
umask 077
if [ ! -e /data/native ]; then
  node /app/import-full.mjs /config/migration/production-d1.json /config/migration/production-photo.jpeg /app/schema.sql /data/native
fi
test -f /data/native/migration-report.json || { echo 'Missing verified migration; refusing to serve an empty database' >&2; exit 1; }
nginx -t -c /app/nginx-test.conf
node /app/data-audit.mjs before-start
node --experimental-loader=/app/portable/cloudflare-loader.mjs /app/node_modules/vinext/dist/cli.js start --hostname 127.0.0.1 --port 3000 &
app_pid=$!
nginx -c /app/nginx-test.conf -g 'daemon off;' &
proxy_pid=$!
trap 'kill "$app_pid" "$proxy_pid" 2>/dev/null || true; wait || true; exit 0' TERM INT
if ! node /app/gateway-selftest.mjs; then
  kill "$app_pid" "$proxy_pid" 2>/dev/null || true
  exit 1
fi
node /app/data-audit.mjs after-start
while kill -0 "$app_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do sleep 2; done
kill "$app_pid" "$proxy_pid" 2>/dev/null || true
wait || true
exit 1
