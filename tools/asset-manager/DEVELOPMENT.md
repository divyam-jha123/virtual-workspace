# Development

## Prerequisites

- Node ≥ 20, pnpm 10 (repo uses `packageManager: pnpm@10`)
- Docker (for Postgres, and the full-stack image)

## First-time setup

The database normally lives on **Neon** (hosted Postgres). The app itself still runs on your
machine — only the database is remote.

```bash
# from repo root
pnpm install

cd tools/asset-manager
cp .env.example .env
# paste your two Neon connection strings into .env (see below), then:
pnpm prisma:generate
pnpm migrate:deploy       # or: pnpm migrate:dev  (creates a migration from schema changes)
pnpm seed                 # rebuilds the Office Interior pack from content/tiles/
```

### Neon connection strings

Neon gives you **two** URLs that differ by hostname. Copy both from its dashboard:

| Variable | Which one | Used by |
|---|---|---|
| `DATABASE_URL` | the **pooled** host (contains `-pooler`) | the app's queries |
| `DIRECT_DATABASE_URL` | the **direct** host | `prisma migrate` |

Migrations cannot run over the pooler, which is why both exist. Keep `?sslmode=require` on
each — Neon rejects plaintext. The real values belong in `.env` (gitignored); never put them
in `docker-compose.asset-manager.yml`, which is committed.

Against a plain local Postgres there is no pooler, so the two are the same string. Leave
`DIRECT_DATABASE_URL` out entirely and it defaults to `DATABASE_URL` — the Prisma commands go
through `scripts/prisma.mjs`, which applies that default before handing off to the CLI.

Neon suspends an idle database, so the first query after a pause takes a second or two to
wake it. That is expected.

### Local Postgres instead

Still available, now opt-in via the `localdb` profile so it doesn't start when you're on Neon:

```bash
docker compose -f infra/docker/docker-compose.asset-manager.yml --profile localdb up -d asset-db
```

## Running

```bash
pnpm dev          # API :3300 (tsx watch) + UI :3301 (next dev), concurrently
pnpm dev:api      # just the API
pnpm dev:web      # just the UI
```

The Next UI proxies `/api` and `/v1` to the API (`next.config.mjs` rewrites), so the browser
stays same-origin.

## Common tasks

```bash
pnpm seed                 # ingest the repo's office art -> "Office Interior" pack
pnpm vendor               # push every placeable tileset + catalog into content/
pnpm vendor office-props  # vendor specific tileset keys
```

## Build & lint

```bash
pnpm build     # prisma generate + tsc (server) + next build
pnpm lint      # tsc --noEmit on the server
```

## Tests

Tests need a **separate** Postgres database so they never touch dev data. Keep this on the
local container rather than Neon — the suite truncates tables, and it should never be pointed
at the real library by accident.

Setting `DATABASE_URL` on the command line is enough: the Prisma wrapper points the migration
URL at the same database, so an inline override can never migrate whatever `.env` happens to
name.

```bash
# one-time: start the local DB, then create + migrate the test database
docker compose -f infra/docker/docker-compose.asset-manager.yml --profile localdb up -d asset-db
docker exec vw-asset-manager-db psql -U asset_manager -d postgres -c "CREATE DATABASE asset_manager_test"
DATABASE_URL="postgresql://asset_manager:asset_manager@localhost:5434/asset_manager_test?schema=public" pnpm migrate:deploy

# run
DATABASE_URL="postgresql://asset_manager:asset_manager@localhost:5434/asset_manager_test?schema=public" pnpm test
```

What's covered:

- **`contract.live.test.ts`** — boots a live Asset Manager seeded with map-mcp's fixture
  `CATALOG`, points map-mcp's real `HttpAssetRepository` at it, and runs the same behavioural
  assertions as `tools/map-mcp/test/asset-repository.contract.test.ts`. This is the proof the
  Asset Manager is a drop-in `ASSET_APIS` source.
- **`security.zip-slip.test.ts`** — zip-slip, absolute paths, symlink entries, and count/size
  caps (uses a hand-built ZIP so malicious entries can be crafted).
- **`security.path-traversal.test.ts`** — filename sanitization, the storage key jail, and
  `.tsj` image-reference basenaming.

## Schema changes

Edit `prisma/schema.prisma`, then `pnpm migrate:dev --name <change>`. Regenerate the client
with `pnpm prisma:generate` (the build does this automatically).

## Docker image

```bash
docker compose -f infra/docker/docker-compose.asset-manager.yml up --build
```

The container runs migrations (`prisma migrate deploy`), optionally seeds
(`ASSET_MANAGER_SEED=true`), then starts both processes. `content/` is bind-mounted so
vendoring writes reach the host workspace; the object store and DB are named volumes.

## Wiring the MCP to the live API (optional)

Vendoring already makes the local MCP see everything. To instead have the MCP pull over HTTP,
add the Asset Manager as an `ASSET_APIS` source (it does not replace the local catalog):

```
ASSET_APIS='[{"name":"asset-manager","url":"http://localhost:3300/v1","key":"dev-key"}]'
```
