---
name: wire-tiled-asset
description: Wire a raw PNG (dropped into the repo, any resolution) into a Vorkium Tiled tileset and the map-mcp asset catalog so it shows up in Tiled and is placeable via search_assets/place_asset. Use when the user says "add this asset to Tiled", "wire up this sprite", "I added <file>.png, use it in the map", or drops an image and asks for it to be usable in the map editor.
---

# Wire a Tiled asset

Turns a bare image file into a placeable Tiled asset in one step: resize to tile
scale, copy into the right folders, register a `<tile>` in the target `.tsj`/`.tsx`,
and add a `content/assets/catalog.json` record. This is the same mechanical process
done by hand for `sofa-big.png` / `sofa-small.png` — this skill scripts it so any
model or person can repeat it without re-deriving the pipeline each time.

## When to use this

The user has added (or points you to) a PNG somewhere in the repo and wants it
usable in Tiled / placeable on the map. This does **not** place it on any specific
map — it only makes the asset exist and be discoverable. Placing it on
`content/maps/vorkium-hq.tmj` is a separate step; don't touch that map unless asked.

## Before running the script

1. **Find the file.** `find content -iname "<name>*"` if the user only gave a
   filename.
2. **Pick the target tileset.** Almost always `office-props` for furniture/props —
   check `mcp__map-mcp__list_tilesets` or `ls content/tilesets/*.tsj` if unsure.
   The script only *appends* to an existing image-collection `.tsj` (one where each
   tile has its own `image` field, `columns="0"`) — it does not create a new
   tileset from scratch.
3. **Sanity-check the art**, same as any manual add:
   - Is it wildly oversized (e.g. a 1000px+ export)? The script downscales
     automatically, but flag it to the user so they know it happened.
   - Does the perspective/style match the rest of the map (16px top-down office
     art)? An isometric or photoreal sprite will look wrong even if it's wired up
     correctly — say so before or after running the script, don't silently place
     it and move on.

## Running it

```bash
python3 .claude/skills/wire-tiled-asset/scripts/wire_asset.py \
  --image content/tiles/props/sofa-ottoman.png \
  --tileset office-props \
  --name "Sofa ottoman" \
  --category furniture \
  --tags sofa,ottoman,seating \
  --placement floor
```

Key flags:
- `--image` — path to the source PNG, any size/aspect ratio.
- `--tileset` — target tileset id (basename of the `.tsj`, e.g. `office-props`).
- `--name` — display name; also used to derive the catalog id (`<tileset-prefix>.<slug>`)
  and the saved filename (`<slug>.png`).
- `--max-dim` (default 48px, ~3 tiles) — cap on the longest side before scaling
  down. Bump it for something meant to be genuinely large (e.g. a wall mural);
  shrink it for small props.
- `--no-blocking` — pass this for decorative assets that shouldn't block movement.
- `--asset-id` — override the auto-generated catalog id if it collides or reads
  oddly.

The script is idempotent: re-running it with the same `--name`/`--tileset` updates
the existing tile and catalog entry in place instead of duplicating it.

## What it does, concretely

1. Loads the image with Pillow, scales it down (preserving aspect ratio) only if
   it's larger than `--max-dim` on its longest side.
2. Saves the result to **both** `content/tiles/props/<slug>.png` (source, what the
   `.tsx` references, what Tiled opens) and `content/tilesets/<slug>.png` (flat
   copy, what the `.tsj` references — this repo's tilesets keep both in sync, see
   `content/tilesets/README.md`).
3. Appends a `<tile>` to `<tileset>.tsj` (JSON, what map-mcp/the game read) and
   mirrors it into `<tileset>.tsx` (XML, what Tiled itself opens) with the next
   free tile id.
4. Appends a record to `content/assets/catalog.json` — `dimensions` in tiles is
   `ceil(px / 16)` on each axis, `tilesetId`/`tileId` point at the tile just added.

## After running it

- Report the new `asset_id`, the tile id, and whether the image got scaled down
  (and from/to what size) — the user should know if their source art was resized.
- **map-mcp caches the asset catalog at startup.** `search_assets`/`get_asset` will
  not see the new entry until the map-mcp server (or MCP session) restarts. Say
  this explicitly rather than re-querying in a loop expecting it to appear.
- Do not place the asset on any map file unless the user asks — this skill only
  makes the asset exist and be discoverable.
