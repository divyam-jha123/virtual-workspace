# API

Base URL: `http://localhost:3300`. `/v1/*` requires the key; `/api/*` is open to localhost.

## Auth (`/v1` only)

Send the static key (`ASSET_MANAGER_API_KEY`, default `dev-key`) as **either**:

```
Authorization: Bearer <key>
X-API-Key: <key>
```

The map MCP sends both. A missing/invalid key returns `401`.

## `/v1/*` — native MCP contract

| Method & path | Returns |
|---|---|
| `GET /v1/assets?q=&category=&style=&placement=&tileset=&tileSize=&limit=` | `{ items: AssetRecord[], total }` — placeable, non-flagged-pack assets, filtered server-side |
| `GET /v1/assets/:id` | `{ asset: AssetRecord }` or `404` |
| `GET /v1/tilesets` | `{ items: TilesetRef[] }` — 16px tilesets only |
| `GET /v1/tilesets/:key.tsj?version=` | Tiled tileset JSON (tilewidth forced to 16, basename images); ETag + `304` |
| `GET /v1/tilesets/:key/:image.png` | PNG bytes (magic-checked) |
| `POST /v1/selections` `{prompt, candidateIds[], ttlSeconds?}` | `201 { token, prompt, status, candidateIds, chosenId, expiresAt, url }` — opens a pick session |
| `GET /v1/selections/:token` | the same shape; poll this until `status != "pending"`. Never ETag'd |
| `POST /v1/selections/:token/cancel` | marks it `cancelled` |

### Selections

One "which of these?" question: the MCP creates it, a person answers it in the browser at
`url` (`/pick/<token>`), the MCP polls until it resolves. `status` is
`pending | chosen | cancelled | expired`; expiry is applied lazily on read. Candidate ids are a
snapshot — the answer must be one of them, so a crafted POST cannot select art that was never
offered. The token is 32 hex chars of CSPRNG because the pick page is served from the
unauthenticated `/api` surface, where the token *is* the capability.

`AssetRecord` matches `tools/map-mcp/src/services/assets/types.ts`: `id, name, category,
subcategory?, tags[], style?, tileSize, dimensions{width,height}, placement, tilesetId, tileId,
collision?, interaction?, source?, version?`.

## `/api/*` — UI / admin

### Packs
- `GET /api/packs` · `POST /api/packs` `{name, slug?, tileSize?, licenseId?, …}`
- `GET/PATCH/DELETE /api/packs/:id`

### Assets
- `GET /api/assets?packId=&type=&tag=&licenseId=&q=&placeable=true`
- `POST /api/assets` `{name, packId, tilesetKey?|tilesetId?, tileId?, widthTiles?, heightTiles?, placement?, collision?, interaction?, tags?, …}`
- `GET /api/assets/:idOrSlug` · `PATCH /api/assets/:id` · `DELETE /api/assets/:id`

Both list and detail include `imageUrl` — the asset's sprite. It is resolved through the
tileset (collection `.tsj` tile image, else the atlas), because `AssetFile` rows hang off the
tileset and an asset's own `files` array is always empty.

### Selections (browser side, no key)
- `GET /api/selections/:token` → `{ …status, candidates: [{slug, name, widthTiles, heightTiles, placement, imageUrl, …}] }`, in the order offered
- `POST /api/selections/:token/choose` `{assetId}` → records the answer; `400` if it was not offered or the selection is already resolved

### Tilesets & the inspector
- `GET /api/tilesets?packId=` — list
- `GET /api/tilesets/:key` — detail incl. `tiles[]` (tileId, image/atlas offset, size) for the inspector
- `GET /api/tilesets/:key/atlas` — the single atlas PNG (grid tilesets)
- `POST /api/tilesets/:key/assets` `{name, tileId, widthTiles?, heightTiles?, placement?, collision?, interaction?, tags?}` — mint an Asset from a selected tile

### Tags & Licenses
- `GET/POST /api/tags`, `DELETE /api/tags/:id`
- `GET/POST /api/licenses`, `GET/PATCH/DELETE /api/licenses/:id`

### Import (staged, two-step)
- `POST /api/import` (multipart `files[]` + `packName`, `tileSize?`, `licenseName?`, …) → review `{ stagingId, tilesets[], warnings[], … }`, no DB writes
- `POST /api/import/:stagingId/commit` → `{ packSlug, tilesetKeys[], assetSlugs[], warnings[] }`

### Vendor
- `POST /api/vendor` `{ tilesetKeys?, packId? }` → writes `content/tilesets/*.tsj` + images,
  merges `content/assets/catalog.json`, writes the lockfile; returns what was written.

### Files & health
- `GET /api/files/:key` — a stored object by opaque key (never a filesystem path)
- `GET /health` → `{ status, db }`

## Errors

`{ error: <code>, message, fix? }` with a matching HTTP status (`400/401/404/409/413/422/500`).
Raw stack traces and filesystem paths are never returned.
