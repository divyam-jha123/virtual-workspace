# Asset Manager — Implementation Proposal

Dev tooling that lives at `tools/asset-manager`, beside `tools/map-mcp`. It serves the
map MCP's **existing** asset-API contract natively under `/v1/*`, adds a UI-facing API
under `/api/*`, and vendors real tileset art into `content/tilesets/` so `place_asset`
works end to end. It does **not** touch `apps/**`, add tenancy/auth accounts, or rewrite
map-mcp's asset layer.

> Note on process: you asked for a proposal-then-approve gate per phase, but also told me
> (in the wrapping instructions) to work autonomously through the night and not block on
> confirmation. Since you're asleep, I've written this proposal as the record of decisions
> and am proceeding through the phases without waiting. Anything I genuinely need from you
> is collected at the very end of the final summary, not here.

## 1. Ground truth verified (binding facts I built against)

- `AssetRecord` (types.ts) is the only shape crossing the seam. A placeable record needs
  `tileSize, dimensions{width,height}, placement, tilesetId, tileId` (+ optional
  `collision`, `interaction`). `record.ts` coerces/validates untrusted input and **drops**
  records missing `tilesetId`/`tileId`/valid dimensions.
- `AssetService.search` **forces `tileSize: 16`** (TILE_SIZE) as the default filter, so any
  record not drawn for 16px is silently invisible to the MCP. → non-16 packs are stored but
  excluded from `/v1`.
- HTTP contract (asset-api-dto.ts / http-repository.ts), all under the configured base
  (`.../v1`): `GET /assets?q&category&style&placement&tileset&tileSize&limit` →
  `{items:[]}` (bare array ok); `GET /assets/{id}` → `{asset}` or bare; `GET /tilesets` →
  `{items:[]}`; `GET /tilesets/{id}.tsj?version=` → Tiled JSON; `GET <image basename under
  /tilesets/{id}/>` → PNG (magic-byte + `image/png` checked). Auth = **both**
  `Authorization: Bearer <key>` and `X-API-Key`. ETag revalidation is used, so we emit ETags.
- **Vendoring / validation constraints** (map-service.ts, validator.ts):
  - A bound tileset's `.tsj` must exist at `content/tilesets/{id}.tsj`; every image it
    references must exist by **basename** at `content/tilesets/{basename}.png`.
  - `.tsj.tilewidth` must equal the map tile size (16) or `validate_map` errors. For the
    `office-props` **image-collection** tileset (declared 46×61) the served/vendored `.tsj`
    reports `tilewidth/height: 16`; each tile keeps its own image + native size. Placement
    still works because collection-tile size comes from the per-tile image, not `tilewidth`.
  - `place_asset` requires `asset.tileSize === map.tileWidth` (16). Prop sprites bigger than
    16px are fine: `tileSize` describes the grid the art targets, not the sprite's pixels.
- The MCP cannot read XML `.tsx`. The three `content/tilesets/office-*.tsx` are invisible to
  it today → the importer parses `.tsx` and generates an equivalent `.tsj`.
- `content/assets/` has no `catalog.json`, so `search_assets` returns nothing today. The
  Asset Manager's vendor step writes `content/assets/catalog.json` + vendored tilesets;
  proving `search_assets`/`place_asset` then work is the definition of done.

## 2. Folder structure

`tools/asset-manager/` is a **single pnpm workspace package** (matched by the existing
`tools/*` glob — no nesting, no workspace-glob change). Express API + Next.js UI + Prisma
in one package; two processes at runtime.

```
tools/asset-manager/
  package.json  tsconfig.json  tsconfig.server.json  Dockerfile  .dockerignore  .env.example
  next.config.mjs  tailwind.config.ts  postcss.config.mjs
  prisma/
    schema.prisma
    migrations/                # SQL migrations (prisma migrate)
    seed.ts                    # ingests repo art -> Office Interior pack
  src/                         # Express API (compiled by tsc to dist/)
    index.ts server.ts config.ts db.ts
    storage/  storage.ts local-storage.ts       # putObject/getObject/getUrl/delete
    middleware/ auth.ts cors.ts error.ts
    v1/ v1-router.ts dto.ts                       # native MCP contract
    api/ packs.ts assets.ts tags.ts licenses.ts tilesets.ts import.ts vendor.ts thumbnails.ts
    import/ detect.ts tsx.ts tileset-meta.ts zip.ts thumbnail.ts png.ts
    vendor/ vendor.ts lockfile.ts
    lib/ ids.ts slug.ts filenames.ts errors.ts
  app/                         # Next.js App Router UI (Tailwind)
    layout.tsx globals.css page.tsx
    packs/… assets/… import/… tilesets/[id]/inspector  (client components)
    lib/api.ts
  test/
    contract.live.test.ts      # map-mcp AssetRepository contract vs a LIVE instance
    security.zip-slip.test.ts   security.path-traversal.test.ts   # written before feature
    v1.test.ts  import.test.ts  tsx.test.ts
  storage/                     # local object store (gitignored)  <id>/original.png, thumb.png
```

## 3. Prisma schema (v1 tables only)

Postgres. Enums: `AssetType` (TILESET SPRITE SPRITE_SHEET CHARACTER OBJECT ENVIRONMENT
BUILDING ANIMATION UI FONT MAP_RESOURCE OTHER) and `AssetPlacement` (floor wall ceiling
overlay). No tables for sprite-sheets/animations/categories/version-history.

- **AssetPack**: id, slug(unique), name, description?, source?, sourceUrl?, author?,
  licenseId?, tileSize?(int), timestamps.
- **License**: id, name, licenseName?, licenseUrl?, source?, sourceUrl?, author?,
  attributionRequired(bool), commercialUseAllowed(bool), redistributionAllowed(bool), notes?.
- **Tileset**: id, packId, key(the `.tsj` basename, unique), name, kind(`grid`|`collection`),
  tileWidth, tileHeight, columns, tileCount, imageWidth?, imageHeight?, version(string,
  default "1"), tsjFileId(→AssetFile the generated .tsj), sourceTsxFileId?(→AssetFile),
  imageFileId?(single-atlas grid). Placeable ⇔ tileWidth==16 && tileHeight==16.
- **Asset**: identity + library + placement in one row (per spec):
  - identity/library: id, slug, name, description?, type(AssetType), category(string),
    source?, sourceUrl?, author?, version(string default "1"), packId, licenseId?
  - placement: tileSize(int), widthTiles(int), heightTiles(int), placement(AssetPlacement),
    tilesetId?(→Tileset), tileId?(int), collision(Json?), interaction(Json?)
  - `placeable` computed at serialize time: has tilesetId+tileId (+ tileSize==16). Records
    without it are stored but excluded from `/v1`.
- **AssetFile** (storage location, separate from identity): id, assetId?/tilesetId?/packId?,
  role(`original`|`thumbnail`|`tsj`|`tsx`|`atlas`|`tile-image`|`zip`), storageKey(hashed
  path in the Storage backend — never exposed raw), filename(sanitized), contentType,
  bytes(int), width?, height?, sha256.
- **Tag**: id, slug(unique), label; join table `_AssetTags` (implicit m-n Asset↔Tag).

Identity (`Asset.id`, stable cuid) is decoupled from storage (`AssetFile.storageKey`, hashed).
The MCP only ever sees `Asset.slug`-derived ids and file **basenames**, never storage keys.

## 4. API surface

**`/v1/*` — native MCP contract** (static API key via Bearer or X-API-Key; localhost CORS):
- `GET /v1/assets` — filters (q/category/style/placement/tileset/tileSize/limit); returns
  `{items,total}` of DTOs; **only placeable, tileSize==16, from packs not flagged non-16**.
- `GET /v1/assets/:id` → `{asset}` | 404.
- `GET /v1/tilesets` → `{items}` of placeable tilesets (tileWidth==16).
- `GET /v1/tilesets/:id.tsj?version=` → generated Tiled JSON (tilewidth 16; basename image
  refs). ETag + `If-None-Match` 304.
- `GET /v1/tilesets/:id/:file.png` → PNG bytes (magic-checked), for the MCP's image fetch.

**`/api/*` — UI/admin** (JSON): CRUD `packs`, `assets`, `tags`, `licenses`, `tilesets`;
`POST /api/import` (multipart: png/tsx/tsj/json/zip) → staged review; `POST /api/import/:id/commit`;
`GET /api/tilesets/:id/atlas` + `/tiles/:tileId` (inspector rendering); `POST /api/tilesets/:id/assets`
(turn a selected tile/rect into an Asset); `GET /api/assets/:id/thumbnail`; `POST /api/vendor`
(write into content/); `GET /health`.

## 5. Sync / vendoring design (decision + justification)

**Decision: vendoring is an Asset-Manager action, not a new map-mcp tool.** The spec forbids
adding MCP tools or editing map-mcp, and `place_asset` is on-demand-hostile: it runs over
stdio with `MAP_MCP_OFFLINE`-friendly guarantees and a host-pinned egress allow-list, and the
already-connected server here runs `ASSET_SOURCE=local`. So the reproducible, offline-safe
path is: the Asset Manager **pushes** files the local repository already reads.

`POST /api/vendor {tilesetIds?, packId?}` (and `pnpm --filter asset-manager vendor`) does,
atomically (tmp+rename), for each selected placeable tileset:
1. write `content/tilesets/{key}.tsj` (tilewidth/height forced to 16),
2. write every referenced image by basename into `content/tilesets/`,
3. upsert its placeable assets into `content/assets/catalog.json` (merging, never clobbering
   hand-authored ids — local override layer preserved),
4. record `{tilesetId, version, sha256, files[]}` in `content/tilesets/asset-manager.lock.json`
   so a map is reproducible.

The MCP still **can** pull the identical bytes over HTTP (the `/v1` tileset+image endpoints
match `HttpAssetRepository.fetchTileset`); vendoring is the same contract, driven from the
other side. This keeps map-mcp byte-for-byte untouched while giving the reproducibility a
`sync_tilesets` tool would have.

## 6. Behaviours (decided as instructed)

- 32px (non-16) pack → accepted & stored, **loud UI warning**, excluded from all `/v1`.
- `.tsx` upload → XML parsed, equivalent `.tsj` generated, both kept, relationship recorded;
  relative image paths never broken (canonical stored `.tsj` keeps working paths; the `/v1`
  and vendored `.tsj` use basenames because images are colocated there).
- Licenses stored & shown prominently; never enforced/blocked.
- ZIP in v1: zip-slip/symlink rejection, entry-count + total-size caps, no execution, then a
  review screen before commit.

## 7. Security

MIME + extension + magic-byte validation; size caps; sanitized filenames; unique hashed
storage ids; no path traversal (Storage keys derived from server-side hash, never from client
paths); safe ZIP extraction; uploads never executed; raw FS paths never serialized; CORS
limited to localhost; single static API key from env guards `/v1`.

## 8. Testing bar

- `test/contract.live.test.ts` boots a real Asset Manager instance seeded with map-mcp's
  fixture `CATALOG`, points map-mcp's `HttpAssetRepository` at it, and runs the same
  behavioural assertions as `asset-repository.contract.test.ts`.
- `security.zip-slip.test.ts` + `security.path-traversal.test.ts` written before the importer.
- Lighter component tests on the UI.

## 9. Phases

1. Proposal (this doc).
2. Scaffold + Prisma schema + migration + Storage abstraction + Docker + `/health`.
3. `/v1` contract + `/api` CRUD, green against map-mcp's live contract suite.
4. Import pipeline: upload, detection, `.tsx→.tsj`, tileset metadata, thumbnails, ZIP, review.
5. Next.js + Tailwind UI; tileset inspector last and best.
6. Vendoring/sync into `content/tilesets/` + lockfile.
7. Docs: README, ARCHITECTURE, API, DEVELOPMENT.

## 10. Definition of done

`docker compose up` → UI → create pack → import office art → tag → search "office desk" →
inspect tileset grid → assign tileIds → vendor → the local map MCP's `search_assets` finds
the assets and `place_asset` writes a valid `content/maps/*.tmj` that opens in Tiled with real
art. If `place_asset` fails, it is not done.
