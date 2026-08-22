# Kenney Furniture Kit

Furniture Kit 2.0 by [Kenney](https://www.kenney.nl), **CC0 (public domain)**.
See `License.txt`. Crediting Kenney is appreciated but not required.

**This pack is licensed differently from everything else in `content/tilesets/`.**
The LimeZu Modern Exteriors art is per-buyer commercial and is gitignored — it
must never be committed. Kenney is CC0, so these files *are* tracked in the
repo, which is why they live in their own folder rather than flat alongside the
LimeZu sprites.

## What is here

| folder | files | what |
| --- | --- | --- |
| `side/` | 140 | side-elevation renders, one per object |
| `isometric/` | 560 | the same 140 objects, 4 rotations each (NE/NW/SE/SW) |

The kit's `Models/` folder (17 MB of DAE/FBX/GLTF/OBJ/STL) is **not** copied —
Tiled cannot use 3D models.

Two Tiled tilesets are generated from these by
`tools/map-mcp/scripts/make-kenney-tilesets.mjs`:

- `kenney-furniture-side.tsj`
- `kenney-furniture-isometric.tsj`

Both are collection-of-images tilesets, so each sprite keeps its own size. Open
either from Tiled's Tilesets panel to place them by hand.

## Read this before using them in `vorkium-hq.tmj`

These do **not** drop into the existing map cleanly, for three separate reasons:

1. **Wrong grid.** Every one of the 700 sprites is an arbitrary pixel size —
   109x212, 83x83, 42x68 — and *none* is a multiple of 16. The maps here are on
   a 16px grid, so nothing snaps; each piece has to be nudged into place and
   will straddle tile boundaries.
2. **Wrong projection.** The maps are orthogonal top-down. This kit is
   side-elevation and isometric. An isometric sofa sitting on a top-down floor
   reads as tilted, and no amount of placement fixes that.
3. **Wrong style.** Kenney's renders are smooth, soft-shaded 3D. LimeZu's art is
   hard-edged 16px pixel art. Side by side in one room they do not look like
   they belong to the same game.

They are perfectly good assets — just for a differently-projected map. If you
want a room built from these, it wants its own map authored at their scale
rather than mixing them into the pixel-art floor.
