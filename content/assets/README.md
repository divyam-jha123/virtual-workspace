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

Switch to the remote catalog with `ASSET_SOURCE=api` plus `ASSET_API_URL` and
`ASSET_API_KEY`; nothing above the `AssetRepository` interface changes.
