# map-mcp — the map-design MCP server

An MCP server that lets Claude author [Tiled](https://www.mapeditor.org/) maps for
the virtual office: search an asset catalog, build a `.tmj`, validate it against
the project's conventions, and save it where Tiled and Git can see it.

It runs over **stdio** — no ports, no auth surface, and the process dies with the
session. Its only filesystem access is the repo's `content/` directory.

**Review happens in Tiled, not in-game.** The Phaser migration is a separate
project; until it lands, opening `content/maps/*.tmj` in Tiled is how you see what
was authored, with the real art.

**There is no ready-made asset API to point this at.** See
[Getting art](#getting-art) below — today that means downloading a tileset by hand
and vendoring it into `content/`.

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
        "--security-opt", "no-new-privileges",
        "-v", "${PWD}/content:/workspace",
        "-e", "MAP_MCP_WORKSPACE=/workspace",
        "-e", "ASSET_APIS",
        "-e", "ASSET_SOURCE",
        "-e", "ASSET_API_URL",
        "-e", "ASSET_API_KEY",
        "vorkium/map-mcp:dev"
      ]
    }
  }
}
```

`-e ASSET_APIS` / `-e ASSET_API_KEY` with no `=value` passes the value through
from your shell environment: keys are never written into the image, a compose
file, or this repo.

`docker compose up` is *not* how you run it — the MCP client starts one container
per session and talks to it over stdin/stdout. Compose exists to build the image
and to document the runtime contract.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MAP_MCP_WORKSPACE` | `./content` | Absolute path to the workspace root. `/workspace` in the container. |
| `ASSET_APIS` | — | JSON array of remote sources, layered on top of the local catalog. See below. |
| `ASSET_SOURCE` | `local` | Legacy single-source switch. Ignored when `ASSET_APIS` is set. |
| `ASSET_API_URL` | — | Legacy single source's base URL, used only when `ASSET_APIS` is unset. |
| `ASSET_API_KEY` | — | Key for the legacy single source. Never logged, never echoed in a tool result. |
| `MAP_MCP_OFFLINE` | `false` | Refuse all outbound requests. |
| `MAP_MCP_LOG_LEVEL` | `warn` | `silent`/`error`/`warn`/`info`/`debug`, to **stderr** only. |
| `MAP_MCP_MAX_MAP_TILES` | `1000000` | Upper bound on tiles in one map. |

With the defaults the server is fully usable with **no credentials and no
network**: `content/assets/` is the catalog.

### Multiple asset sources

`ASSET_APIS` takes a JSON array, one entry per remote catalog:

```bash
ASSET_APIS='[
  {"name":"vendorA","url":"https://a.example.com/v1","key":"..."},
  {"name":"vendorB","url":"https://b.example.com/v1","key":"..."}
]'
```

The **local catalog is always included and always first** — the server stays
usable with zero credentials, and adding a vendor never takes away what you
already had.

`search_assets` queries every source in parallel and merges the results into one
ranked list; nothing in the output reveals which source answered. `get_asset` and
`place_asset` check sources in order and take the first match.

**Same-id collisions resolve by config order.** If your local catalog and vendorA
both publish `office.desk.pod4`, the local one wins, because local is listed
first — a deliberate override always beats a vendor default. Order the `ASSET_APIS`
entries by the precedence you want among vendors.

**One source being down does not break the others.** A failing source contributes
nothing to a search instead of failing the call, and `get_project_info` reports
each source's reachability by name:

```json
"assetSource": { "source": "composite", "reachable": true, "vendoredTilesets": 3,
  "sources": [ { "name": "local", "reachable": true },
               { "name": "vendorA", "reachable": true },
               { "name": "vendorB", "reachable": false, "detail": "…401…" } ] }
```

Each source gets its own `HttpAssetRepository`, so host-pinning is per source: a
redirect from vendorA to vendorB's host is refused just like any other off-host
redirect.

## Getting art

**No public asset library exposes the `AssetRepository` contract this server
expects.** We checked: [itch.io's server-side API](https://itch.io/docs/api/serverside)
covers profiles, purchases and build versions only — no asset browsing, no
downloads. Kenney, OpenGameArt and CraftPix have no API at all — they're zip
downloads behind an HTML page. [Poly Haven](https://polyhaven.com/our-api) and
[ambientCG](https://docs.ambientcg.com/api/) *do* have real JSON search APIs, but
they serve HDRIs, 3D models and PBR textures — nothing with a tile grid, so there's
no `{tilesetId, tileId}` to place. `ASSET_APIS` exists for when a real catalog
API — a partner's, or one you build — does show up; until then it has nothing to
point at.

So today, art comes in by hand, in three steps:

**1. Download a pack.** [Kenney](https://kenney.itch.io/) (CC0, no attribution
required) is the easiest starting point — its indoor/roguelike packs fit an
office. OpenGameArt and itch.io have more, but **check the license on each pack
individually**: OpenGameArt mixes CC0, CC-BY (needs attribution) and GPL
(viral) in the same catalog, and many itch.io packs are sale-only with no
redistribution rights. Kenney's CC0 blanket license is why it's the default
recommendation.

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
file, `search_assets` searches all of them as one catalog, no config needed. This
is genuinely how you use "multiple libraries" right now: not multiple API
sources, but multiple catalog files sitting side by side.

**What's still missing to make a remote source fully usable:** even once a real
catalog API exists and is wired up via `ASSET_APIS`, `place_asset` still requires
the tileset to be vendored in `content/tilesets/` first — `HttpAssetRepository`
can *find* remote assets today, but nothing yet downloads and vendors their
tileset automatically. That's `TilesetCache` / `sync_tilesets` / `lockfile.json`,
explicitly deferred to a later branch (see [Scope](#scope)). Until it lands, a
remote asset's tileset has to be fetched and placed into `content/tilesets/` by
hand, the same as everything above.

## Tools

| Tool | What it does |
|---|---|
| `get_project_info` | Conventions, map index, asset-source status, vendored tileset count. Call this first. |
| `search_assets` | Ranked, synonym-expanded catalog search, filtered to the project tile size. |
| `get_asset` | One asset record in full. |
| `list_tilesets` | Which tilesets exist, and which are vendored (= usable by Tiled). |
| `read_map` | Semantic view of a map plus its current diagnostics. |
| `create_map` | New draft with the standard layer stack. |
| `add_layer` / `place_tiles` / `add_object` / `move_object` / `remove_object` / `set_property` | Semantic mutations. |
| `place_asset` | Place catalog art: binds the tileset, anchors the sprite, carries interaction metadata, marks collision. |
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
- **Egress** is pinned per source to that source's configured URL. A redirect to
  another host is refused,
  and a URL found inside a map or asset payload is *never* fetched — payloads are
  untrusted data.
- **Downloads** are content-type checked, size-capped, PNG-magic verified, and
  their filenames stripped to a safe basename before anything is written.
- **The API key** lives in the environment only: never in the image, never in a
  log line, and redacted from every diagnostic. Rotate it by restarting the
  session with a new value.
- **The container** mounts only `content/`, runs as `node`, has no published
  ports, and executes no shell.

## Testing

```bash
pnpm --filter map-mcp test
```

- **Path security** — every traversal shape, written before the tools.
- **Contract** — one `AssetRepository` suite that the local, HTTP **and composite**
  implementations must all pass. This is what keeps the source swappable and the
  whole suite runnable offline.
- **Multi-source** — collision precedence, partial-failure degradation, and an
  end-to-end run with a local catalog plus two vendor APIs through the real server.
- **Mocked HTTP** — retry/backoff, 401, 429 with `Retry-After`, ETag 304,
  off-host redirect, oversized payload, corrupt image, key redaction.
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

This branch is the MCP server and its Docker packaging — nothing else. No changes
to `apps/frontend/src/game/**`, no map porting, no Phaser work, no tileset
vendoring. Deferred to later branches: `TilesetCache` + `sync_tilesets` +
`lockfile.json`, `export_runtime_map`, `get_map_diff` / `set_map_state`,
`open_in_tiled`, and `packages/map-schema` (the schema lives standalone in
`src/schema/` until the Phaser work needs to share it — the same files move, the
imports change).

See [`docs/map-design-mcp-plan.md`](../../docs/map-design-mcp-plan.md) for the full plan.
