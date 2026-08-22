# `content/` — the map-design workspace

This directory is the **only** thing mounted into the `map-mcp` container
(`-v ./content:/workspace`). The MCP server can read and write here and nowhere
else; it never sees `apps/`, `.env`, or `.git`.

| Directory | Contents | Written by |
|---|---|---|
| `maps/` | canonical Tiled maps (`.tmj`) — commit these | MCP + humans (Tiled) |
| `tilesets/` | vendored tilesets (`.tsj`) and their atlas images | you, by hand |
| `assets/` | the asset catalog — the filesystem is the only asset source | you, by hand |
| `schemas/` | published JSON Schema for the map contract | MCP |
| `runtime/` | exported Phaser-loadable bundles (build artifacts) | MCP |
| `.map-mcp/` | drafts, snapshots, `status.json` — not committed | MCP |

Paths are always **workspace-relative ids** (`maps/hq.tmj`), never absolute.
Anything outside this tree, and any `..` or escaping symlink, is rejected.

## Before you open a map (two-person setup)

Maps are committed; most of the art they reference is not. `maps/vorkium-hq.tmj`
names **13 tilesets**, and only the Kenney one is in the repo — open the map on a
fresh clone without doing the steps below and Tiled reports the rest as missing.
**Do not save from that state:** Tiled writes back what it managed to load, so a
save silently drops every layer that used a missing tileset.

| Tileset | Where it comes from |
|---|---|
| `kenney-furniture/kenney-lobby.tsj` | in the repo — CC0, nothing to do |
| `limezu-*.tsj` (10 themes) | regenerate locally, see below |
| `office-props.tsj`, `modern-office-modern-office-props.tsj` | **no documented rebuild yet** — see the gap below |

### LimeZu themes

The pack is licensed per buyer and must never be committed. Buy Modern Exteriors,
unzip it to `tools/map-mcp/modernexteriors-win/` (gitignored), then:

```
node tools/map-mcp/scripts/import-limezu.mjs --themes additional_houses,city_props,city_terrains,garden,office,police_station,subway_and_train_station,terrains_and_fences,vehicles,villas
```

The importer must produce the **same tile order on both machines** — tile ids are
positional, so if your import and your teammate's disagree, the shared map renders
as scrambled furniture rather than failing loudly. If a map opens with the right
layout but the wrong objects, suspect this first and compare tilecounts before
touching the map.

### Known gap

`office-props.tsj` and `modern-office-modern-office-props.tsj` are collection-of-
images tilesets whose per-tile PNGs are gitignored, and no tracked script
regenerates them. `office-props.tsx` (tracked) describes the same 28 tiles but is
not a substitute — it names different tile dimensions. Right now these two only
exist on the machine that made them, which means a second person cannot fully
open `vorkium-hq.tmj`. Closing this needs either a generator script committed
alongside the others, or a decision to commit the art if its license allows.

## Working on a map with someone else

`.tmj` files are single-line JSON — a 291 KB line, for `vorkium-hq.tmj`. Git can
merge two edits to one only by producing a conflict no one can resolve by hand,
so treat map files as **exclusively locked**: say in chat that you are taking the
map, push before handing it back. If that starts to chafe, split the map by zone
into separate `.tmj` files rather than trying to make the merge work.
