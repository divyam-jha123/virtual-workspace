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
exist on the machine that made them, which means teammates cannot fully open
`vorkium-hq.tmj`.

Until this is closed with a committed generator or a license-approved decision to
track the source art, map edits that touch these two tilesets must be made by the
person who has the source images locally. Everyone else should treat those layers
as read-only and avoid saving partial loads.

## Working on a map with someone else

`.tmj` files are single-line JSON — a 291 KB line, for `vorkium-hq.tmj`. Git can
merge two edits to one only by producing a conflict no one can resolve by hand,
so treat map files as **exclusively locked**: say in chat that you are taking the
map, push before handing it back. If that starts to chafe, split the map by zone
into separate `.tmj` files rather than trying to make the merge work.

## Asset sync workflow (for 3 coders)

Use this when multiple people are editing maps so everyone stays on the same
asset state in Git.

1. Pull latest `main` before opening Tiled.
2. Run the LimeZu importer with the exact theme list from this README.
3. Confirm `git status` is clean before editing; if not, stop and reconcile first.
4. Announce map lock in team chat (who owns `maps/vorkium-hq.tmj` right now).
5. Commit map + tileset metadata changes together in one commit.
6. Push immediately after map work; unlock in chat.

Team rules:
- Never commit licensed raw packs (for example, `tools/map-mcp/modernexteriors-win/`).
- Never save a map that opened with missing tilesets.
- If tile ids look scrambled, do not "fix by eye"; re-run importer and compare generated tileset sizes first.
