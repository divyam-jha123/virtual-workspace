# Architecture

## Position in the repo

The Asset Manager is **dev tooling**, like `tools/map-mcp`. It never touches `apps/**`, the
product backend, or its database. It has its own Postgres, its own object store, and one static
API key. The map MCP's asset layer is **not modified** — the Asset Manager plugs into the seam
that already exists (`AssetRepository`, `asset-api-dto.ts`, `composite-repository.ts`).

## Two HTTP surfaces

| Surface | Auth | Consumer | Shape |
|---|---|---|---|
| `/v1/*` | static key (Bearer **and** X-API-Key) | the map MCP's `HttpAssetRepository` | the MCP's existing contract, matched exactly |
| `/api/*` | none (localhost CORS) | the Next.js UI | CRUD, import, inspector, vendor |

`asset-api-dto.ts` in map-mcp is the spec; the server matches it, not the reverse. `/v1`
serialises domain rows into the `AssetRecord` shape and applies the MCP's own filter rules
(category / style / placement / tileSize) **server-side**, because `HttpAssetRepository` only
re-ranks — it does not re-filter.

## The placeability contract (why this tool exists)

A record the MCP can place needs `tileSize=16, dimensions, placement, tilesetId, tileId`, and
the tileset must be **vendored** (`content/tilesets/<id>.tsj` + every referenced image by
basename). Three facts from the MCP source shape everything:

1. `AssetService.search` forces `tileSize:16`, so non-16 art is silently invisible. → `/v1`
   excludes any pack flagged non-16 and honours the `tileSize` query param.
2. `validator.ts` rejects a tileset whose `.tsj.tilewidth != 16` on a 16px map. → the served
   and vendored `.tsj` force `tilewidth/height:16`. For an **image-collection** tileset
   (variable-size sprites, e.g. `office-props` declared 46×61) this is correct: the declared
   size is a bounding-box default; each tile still renders at its own image size. Collection
   tilesets are normalised to a 16px grid at ingest.
3. `map-service.ts` resolves atlas images by **basename** (`tilesets/<basename>.png`). →
   vendoring colocates every image beside the `.tsj`, and image references are reduced to
   basenames (`normalizeTsjForVendor`). Source `.tsx`/`.tsj` relative paths are never rewritten
   in place — the vendored copy is a separate artifact.

## Data model

Seven tables (`prisma/schema.prisma`): `AssetPack`, `Asset`, `AssetFile`, `Tileset`, `Tag`,
`License`, and `Selection` (a handshake, not content — see below). The `AssetType` enum is wide, but there are no tables for sprite sheets, animations,
categories, or version history — `version` is a string.

**Identity vs storage** are separated: `Asset.id`/`slug` is the stable identity the MCP sees;
bytes live in `AssetFile` under an opaque, hashed `storageKey` that is never serialized. `Asset`
carries both the library fields (name, slug, type, category, tags, source, author, version…)
and the placement fields (tileSize, widthTiles, heightTiles, placement, tilesetId, tileId,
collision, interaction) in one row, as specified.

## Storage seam

`Storage` (`putObject/getObject/getUrl/delete/exists`) is the only thing that touches bytes.
`LocalStorage` writes hash-sharded files under `storage/` and serves them through an
authenticated `/api/files/:key` route — never a raw filesystem path. Swapping in S3/R2 is a
constructor change; no caller knows the difference.

## Import pipeline

`upload → detect (ext + magic bytes) → parse (.tsx XML / .tsj JSON / catalog JSON / safe ZIP)
→ stage (blobs + manifest in storage, no DB writes) → review → commit (ingest)`. `ingest` is
shared by the importer and the seed, so both take the identical path. ZIP extraction rejects
zip-slip, absolute paths, and symlinks, and caps entry count and total size.

## Vendoring / sync

**Decision: vendoring is an Asset-Manager action, not a new map-mcp tool** — the spec forbids
changing map-mcp, and the connected server runs `ASSET_SOURCE=local`. So the Asset Manager
*pushes* files the local repository already reads: `.tsj` + images into `content/tilesets/`, a
merged `content/assets/catalog.json` (hand-authored ids are preserved — the local override
layer is never clobbered), and `content/tilesets/asset-manager.lock.json` for reproducibility.
The `/v1` tileset + image endpoints serve the identical bytes, so an HTTP-pull path
(`HttpAssetRepository.fetchTileset`) also works unchanged — same contract, driven from the
other side.

**The pull path is now the normal one.** map-mcp's `sync_tilesets` writes `.tsj` + images into
`content/tilesets/` itself, and `place_asset` triggers it when a placement needs art that is
not on disk — so no manual vendor click stands between importing art and using it. Vendoring
remains for the offline/reproducible case and still writes `catalog.json` and the lockfile.
One consequence worth knowing: `CompositeAssetRepository` is local-first, so a forced refresh
uses `fetchTilesetFromRemote`, or the stale local copy would answer instead of the server.

## Security

MIME + extension + magic-byte validation; upload and ZIP size caps; sanitized filenames;
opaque hashed storage keys (clients can't influence where bytes land); no path traversal; safe
ZIP extraction; uploads are never executed; raw paths never leave the process; CORS limited to
localhost; `/v1` gated by one env-configured static key matching the Bearer + X-API-Key the MCP
sends.

## Selections (the browser picker)

A seventh table, `Selection`, is the only one that is not asset library content — it is a
short-lived handshake. The MCP posts a shortlist to `/v1/selections`, gets a token and a
`/pick/<token>` url, and polls `GET /v1/selections/:token` until it resolves. A person opens
that url, sees the candidates as sprites, and clicks one.

Two rules make an unauthenticated pick page safe:

1. **The token is the capability.** `/api` has no login, so the token is 32 hex chars of
   CSPRNG and the row carries an `expiresAt` that is applied lazily on read.
2. **The candidate list is the allowlist.** An answer must name an id that was offered when the
   question was asked, so a crafted POST cannot select art that was never on the page. The
   answer is written with a conditional update, so two browsers racing cannot both win.

Sprites on that page come from `AssetImageResolver` (`src/lib/asset-image.ts`), which resolves
an asset's picture *through its tileset* — the collection `.tsj` maps `tileId` to a per-tile
image, and a grid atlas falls back to the atlas itself. `AssetFile` rows hang off the tileset,
never the asset, so `asset.files` is empty for every asset; reading it is why thumbnails
rendered blank.
