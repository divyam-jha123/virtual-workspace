# `assets/` — the local asset library

The default asset source (`ASSET_SOURCE=local`), so the MCP is fully usable with
no API credentials. Drop asset records here and `search_assets` / `get_asset`
find them.

Two accepted shapes:

1. **A catalog file** — `assets/catalog.json`, either a bare array of asset
   records or `{ "assets": [ ... ] }`.
2. **One file per asset** — `assets/<anything>.json` containing a single record.

Record shape (see `tools/map-mcp/src/services/assets/types.ts`):

```json
{
  "id": "office.desk.pod4",
  "name": "Four-person desk pod",
  "category": "furniture",
  "subcategory": "desk",
  "tags": ["desk", "pod", "workstation"],
  "style": "modern",
  "tileSize": 32,
  "dimensions": { "width": 4, "height": 3 },
  "placement": "floor",
  "tilesetId": "office-core",
  "tileId": 42,
  "collision": { "blocking": true },
  "interaction": { "class": "workstation", "capacity": 4 },
  "version": "1"
}
```

## An asset needs real art behind it

A catalog record is metadata; it points at a tile in a tileset. Before
`place_asset` will work, `content/tilesets/` needs BOTH files:

```
content/tilesets/my-pack.tsj    <- Tiled tileset (New Tileset... -> Based on Tileset Image)
content/tilesets/my-pack.png    <- the atlas image the .tsj names
```

`tilesetId` in the record is the `.tsj` basename; `tileId` is the 0-based index of
the tile in the atlas (left-to-right, top-to-bottom), which Tiled shows when you
select a tile. Both files must be present — a `.tsj` whose image is missing is a
save-blocking error, because the map would open blank in Tiled.

**There's no API to pull that art from yet.** No public asset library (Kenney,
OpenGameArt, itch.io, CraftPix) exposes a JSON catalog — they're zip downloads.
Download a pack by hand, check its license (Kenney is CC0 and the easiest safe
default; OpenGameArt mixes licenses per-asset), and record it in `source.license`
above so that's not lost once several packs are mixed together. See
[`tools/map-mcp/README.md#getting-art`](../../tools/map-mcp/README.md#getting-art)
for the full walkthrough.

## Adding remote catalogs

Set `ASSET_APIS` to a JSON array of `{name, url, key}` to layer one or more remote
catalogs on top of this directory:

```
ASSET_APIS=[{"name":"vendorA","url":"https://a.example.com/v1","key":"..."}]
```

This directory is always included and always searched first, so a record here with
the same `id` as a vendor record wins — local overrides beat vendor defaults.
Nothing above the `AssetRepository` interface changes. The request/response mapping
is assumed until someone points it at a live API — see
`tools/map-mcp/src/services/assets/asset-api-dto.ts`.
