# `assets/` — the asset library

The asset catalog, read straight from this folder — the filesystem is the only
source, so the MCP is fully usable with no API and no credentials. Drop asset
records here and `search_assets` / `get_asset` find them by scanning `assets/*.json`.

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

**Art comes in by hand — there's no importer or asset service.** Download a pack,
check its license (Kenney is CC0 and the easiest safe default; commercial packs
like LimeZu's Modern Exteriors are purchased and not redistributed), drop its
`.tsj` + `.png` in `content/tilesets/`, and record the license in `source.license`
above so it's not lost once several packs are mixed together. See
[`tools/map-mcp/README.md#getting-art`](../../tools/map-mcp/README.md#getting-art)
for the full walkthrough.

## Multiple catalog files

Every `*.json` file in this directory is merged into one catalog — a bare array of
records or `{ "assets": [ … ] }` in each. Add a library by dropping another catalog
file beside the others; `search_assets` searches them all as one. No config needed.
