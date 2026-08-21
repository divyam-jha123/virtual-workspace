#!/usr/bin/env sh
set -e

cd /app/tools/asset-manager

# Migrations retry rather than assuming the database is up. Two cases need it:
# a local Postgres container still booting, and a Neon instance waking from
# idle — both look like a connection refusal for the first few seconds.
echo "[asset-manager] applying database migrations..."
attempt=1
max_attempts=10
until pnpm migrate:deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[asset-manager] migrations failed after ${max_attempts} attempts; giving up." >&2
    echo "[asset-manager] check DATABASE_URL and DIRECT_DATABASE_URL." >&2
    exit 1
  fi
  echo "[asset-manager] database not ready (attempt ${attempt}/${max_attempts}); retrying in 3s..."
  attempt=$((attempt + 1))
  sleep 3
done

if [ "${ASSET_MANAGER_SEED:-false}" = "true" ]; then
  echo "[asset-manager] seeding office art..."
  pnpm exec tsx prisma/seed.ts || echo "[asset-manager] seed skipped/failed (continuing)"
fi

echo "[asset-manager] starting API (3300) + UI (3301)..."
exec pnpm start
