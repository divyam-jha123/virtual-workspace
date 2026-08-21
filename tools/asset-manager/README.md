# Asset Manager

Dev tooling for the **map-design MCP** (`tools/map-mcp`). It is the asset library and
tileset pipeline that turns raw art into records the MCP can **place** on a map — and vendors
the tileset files so `place_asset` works end to end.

It lives beside `tools/map-mcp`, is **not** part of the product backend, and adds **no**
tenancy, user accounts, or auth beyond a single static API key.

```
┌──────────────┐   /v1 (native MCP contract)     ┌──────────────┐
│  map-mcp     │  ─ Bearer + X-API-Key ─────────▶ │ Asset Manager│
│ (search /    │                                  │   API :3300  │
│  place_asset)│  ◀─ vendored .tsj + images ───   │   UI  :3301  │
└──────┬───────┘        content/tilesets/         └──────┬───────┘
       │                content/assets/catalog.json      │ Postgres :5434
       ▼                                                  ▼ local storage/
   content/maps/*.tmj  ← real art, valid in Tiled     tools/asset-manager/storage/
```

## What it does

- Serves the MCP's existing HTTP contract natively under `/v1/*` — the Asset Manager is just
  one `ASSET_APIS` source, no MCP change required.
- Imports art: `.png`, `.tsx` (parsed to `.tsj`), `.tsj`, `.json` catalogs, and `.zip`
  (extracted safely), with a review screen before anything is committed.
- **Tileset inspector**: render an atlas with a 16px grid overlay (or a collection gallery),
  click a tile to get its `tileId`, and mint an Asset with dimensions, placement, collision,
  and interaction class.
- **Vendors** placeable tilesets + their images + a merged `catalog.json` into `content/`,
  plus a lockfile — so the already-connected `ASSET_SOURCE=local` MCP can place them offline.

## Quick start (Docker — recommended)

```bash
# from the repo root
docker compose -f infra/docker/docker-compose.asset-manager.yml up --build
```

- UI:  http://localhost:3301
- API: http://localhost:3300  (`/health`, `/v1/*` needs the key, `/api/*` open to localhost)
- Postgres: localhost:5434

Seed the repo's office art on first boot with `ASSET_MANAGER_SEED=true`:

```bash
ASSET_MANAGER_SEED=true docker compose -f infra/docker/docker-compose.asset-manager.yml up --build
```

Then, in the UI: open the **Office Interior** pack → a tileset → the inspector, or hit
**Vendor all → content/** on the Packs page to push everything into the map-mcp workspace.

## Quick start (local, no Docker)

```bash
# 1. a Postgres for the tool (the compose file just runs the DB)
docker compose -f infra/docker/docker-compose.asset-manager.yml up -d asset-db

cd tools/asset-manager
cp .env.example .env                       # defaults point at localhost:5434
pnpm install                               # from repo root if first time
pnpm prisma:generate
pnpm migrate:deploy                        # create tables
pnpm seed                                  # ingest the repo's office art (optional)
pnpm dev                                   # API :3300 + UI :3301
```

## The definition of done, reproduced

```bash
pnpm seed                                  # Office Interior pack: 3 tilesets, 18 assets
pnpm vendor                                # writes content/tilesets/*.tsj + images + catalog.json
```

Now the map MCP (`ASSET_SOURCE=local`, workspace `./content`) can:

- `search_assets "office desk"` → returns `office.desk` and friends (was empty before),
- `place_asset office.desk` onto a map, and
- `save_map` — which passes validation, referencing real art that opens in Tiled.

## Layout

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the design, [`API.md`](./API.md) for the HTTP
surface, [`DEVELOPMENT.md`](./DEVELOPMENT.md) for day-to-day work, and [`PROPOSAL.md`](./PROPOSAL.md)
for the original plan and the ground-truth facts it was built against.
