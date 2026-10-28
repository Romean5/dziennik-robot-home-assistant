#!/bin/sh
set -eu
mkdir -p /data/wrangler
if [ -e /app/.wrangler ] && [ ! -L /app/.wrangler ]; then
  echo 'Unexpected non-symlink /app/.wrangler; refusing to overwrite data' >&2
  exit 1
fi
ln -sfn /data/wrangler /app/.wrangler
cd /app
exec npm run dev -- --hostname 0.0.0.0 --port 3000
