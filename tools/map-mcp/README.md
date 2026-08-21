# map-mcp — the map-design MCP server

An MCP server that lets Claude author [Tiled](https://www.mapeditor.org/) maps for
the virtual office: search an asset catalog, build a `.tmj`, validate it against
the project's conventions, and save it where Tiled and Git can see it.

It runs over **stdio** — no ports, no auth surface, and the process dies with the
session. Its only filesystem access is the repo's `content/` directory.

**Review happens in Tiled, not in-game.** The Phaser migration is a separate
project; until it lands, opening `content/maps/*.tmj` in Tiled is how you see what
was authored, with the real art.

**Assets live on the filesystem — there is no asset database or asset service.**
The MCP discovers tilesets and catalog records by scanning `content/`. See
[Getting art](#getting-art) below for how to add a pack.

## Quick start (native, no Docker)

```bash
pnpm install
pnpm --filter map-mcp build
pnpm --filter map-mcp test
```

Then register it with Claude Code:

```json
{
  "mcpServers": {
    "map-mcp": {
      "command": "node",
      "args": ["tools/map-mcp/dist/index.js"],
      "env": { "MAP_MCP_WORKSPACE": "./content" }
    }
  }
}
```

For an edit-reload loop use `pnpm --filter map-mcp dev` (tsx watch) against `./content`.

## Running it in Docker

```bash
docker build -f tools/map-mcp/Dockerfile -t vorkium/map-mcp:dev .
# or: docker compose -f infra/docker/docker-compose.map-mcp.yml build
```

```json
{
  "mcpServers": {
    "map-mcp": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--read-only", "--tmpfs", "/tmp",
        "--network", "none",
        "--security-opt", "no-new-privileges",
        "-v", "${PWD}/content:/workspace",
        "-e", "MAP_MCP_WORKSPACE=/workspace",
        "vorkium/map-mcp:dev"
      ]
    }
  }
}
```

The server makes no outbound network calls, so the container can run with
`--network none`. Its only access to anything is the `content/` bind mount.

`docker compose up` is *not* how you run it — the MCP client starts one container
per session and talks to it over stdin/stdout. Compose exists to build the image
and to document the runtime contract.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MAP_MCP_WORKSPACE` | `./content` | Absolute path to the workspace root. `/workspace` in the container. |
| `MAP_MCP_LOG_LEVEL` | `warn` | `silent`/`error`/`warn`/`info`/`debug`, to **stderr** only. |
| `MAP_MCP_MAX_MAP_TILES` | `1000000` | Upper bound on tiles in one map. |

The server is fully usable with **no credentials and no network**: `content/assets/`
is the catalog and `content/tilesets/` holds the art. There is no asset API to
configure — the filesystem is the only source.

## Getting art

Art comes in by hand, in three steps — there is no importer and nothing to
register; the MCP discovers files by scanning `content/`.

**1. Download a pack.** [Kenney](https://kenney.itch.io/) (CC0, no attribution
required) is the easiest starting point — its indoor/roguelike packs fit an
office. [Modern Exteriors / Modern Office by LimeZu](https://limezu.itch.io/modernexteriors)
is the first commercial pack used here — **purchased, not redistributed**, so its
files stay gitignored and each buyer brings their own. OpenGameArt and itch.io have
more, but **check the license on each pack individually**: OpenGameArt mixes CC0,
CC-BY (needs attribution) and GPL (viral) in the same catalog, and many itch.io
packs are sale-only with no redistribution rights.

**2. Turn it into a `.tsj` in Tiled.** File → New → New Tileset → Based on
Tileset Image, point it at the pack's atlas PNG, save as JSON (**`.tsj`**, not
`.tmx`) into `content/tilesets/<pack-name>.tsj`, with the PNG alongside it. Set
tile width/height to match the project's tile size (`TILE_SIZE` in
[src/schema/index.ts](src/schema/index.ts)) — art on a different grid gets
filtered out of `search_assets` and can't be placed at all.

**3. Describe the assets in a catalog file.** Add
`content/assets/<pack-name>-catalog.json` (or reuse `assets/catalog.json`) with
one entry per placeable asset — `tilesetId` is the `.tsj` basename, `tileId` is
the 0-based tile index Tiled shows when you click a tile:

```json
{"assets":[
  {"id":"kenney.desk","name":"Desk","category":"furniture","tags":["desk"],
   "tileSize":16,"dimensions":{"width":2,"height":1},"placement":"floor",
   "tilesetId":"kenney-office","tileId":12,
   "collision":{"blocking":true},
   "source":{"license":"CC0","author":"Kenney","url":"https://kenney.nl"}}
]}
```

Fill in `source.license` — it's not enforced today, but it's there so you have a
record of what you're allowed to do with each asset once more than one pack is in
play.

Every `*.json` file in `content/assets/` is merged automatically — one library per
file, `search_assets` searches all of them as one catalog, no config needed. Add a
library by dropping another catalog file beside the others.

## Tools

| Tool | What it does |
|---|---|
| `get_project_info` | Conventions, map index, asset-source status, vendored tileset count. Call this first. |
| `search_assets` | Ranked, synonym-expanded catalog search, filtered to the project tile size. Pass `showArt` to get the actual sprites back, so a person can pick by eye. |
| `get_asset` | One asset record in full. |
| `list_tilesets` | Which tilesets exist on disk, and which are vendored (= usable by Tiled). |
| `read_map` | Semantic view of a map plus its current diagnostics. |
| `create_map` | New draft with the standard layer stack. |
| `add_layer` / `place_tiles` / `add_object` / `move_object` / `remove_object` / `set_property` | Semantic mutations. |
| `place_asset` | Place catalog art: binds the tileset, anchors the sprite, carries interaction metadata, marks collision. The tileset must already be a real `.tsj` in `content/tilesets/`. |
| `add_tileset` | Bind a vendored `.tsj` as an external tileset. |
| `validate_map` | Every structural, tileset, object, gameplay and runtime-compat rule. |
| `save_map` | Flush the draft to `.tmj`. **Blocked by any error-severity diagnostic.** |

Resources: `project://config`, `project://conventions`, `map://schema`, `assets://tilesets`.

Every tool answers with the same envelope — `{ "ok": true, ... }` or:

```json
{ "ok": false, "code": "ASSET_NOT_FOUND",
  "diagnostics": [{ "severity": "error", "rule": "asset-missing",
    "message": "No asset with id \"desk\"",
    "fix": "Call search_assets to find a valid id; ids are exact and case-sensitive." }] }
```

The `fix` hint is the point: it is what lets the model correct itself.

## Drafts and saving

Mutations apply to an **in-memory draft**. `save_map` is the only thing that
touches `maps/`, and it refuses to write while any `error` diagnostic stands, so a
half-built map never lands where Tiled or Git would pick it up. Warnings surface
but do not block.

Git stays on the host: this server produces files, it never commits.

## Security posture

- **Path jail** — every path is a workspace-relative id resolved through
  `WorkspaceService`. Absolute paths, `..`, escaping symlinks, unknown top-level
  directories, and non-allowlisted extensions are rejected. No tool takes a raw path.
- **Writes** are confined to `maps/`, `tilesets/`, `assets/`, `runtime/`, `.map-mcp/`,
  and go through tmp+rename so a reader never sees a partial file.
- **No egress.** The server makes no outbound network requests at all; catalog
  files and tilesets are read from `content/`, and a URL found inside a map or asset
  payload is never fetched — payloads are untrusted data.
- **The container** mounts only `content/`, runs as `node`, has no published ports,
  can run with `--network none`, and executes no shell.

## Testing

```bash
pnpm --filter map-mcp test
```

- **Path security** — every traversal shape, written before the tools.
- **Contract** — the `AssetRepository` suite the filesystem catalog must pass.
- **Round-trip** — a hand-authored, Tiled-saved fixture survives
  parse → serialize → parse unchanged.
- **Validation** — one broken fixture per rule.
- **Integration** — an in-process MCP client running whole flows end to end.
- **Smoke** — the built server over a real stdio transport. Point it at the image
  to test the container:

```bash
MAP_MCP_SMOKE_CMD='docker run --rm -i -v /tmp/ws:/workspace -e MAP_MCP_WORKSPACE=/workspace vorkium/map-mcp:dev' \
MAP_MCP_SMOKE_WORKSPACE=/tmp/ws \
pnpm --filter map-mcp test
```

`MAP_MCP_SMOKE_WORKSPACE` is the **host** side of that mount — inside the
container the workspace is `/workspace`, but the test's filesystem assertions run
outside it.

Not automated: the Tiled GUI round-trip. After a map lands, open it in Tiled and
check the art renders, collision looks right, and the spawn is where you meant it.

## Scope

This is the MCP server and its Docker packaging — nothing else. No changes to
`apps/frontend/src/game/**`, no map porting, no Phaser work. Assets are read from
the filesystem; there is deliberately no asset database, asset API, or remote
tileset sync. Deferred to later branches: `export_runtime_map`, `get_map_diff` /
`set_map_state`, `open_in_tiled`, and `packages/map-schema` (the schema lives
standalone in `src/schema/` until the Phaser work needs to share it).

See [`docs/map-design-mcp-plan.md`](../../docs/map-design-mcp-plan.md) for the full plan.
