# map-mcp — the map-design MCP server

An MCP server that lets Claude author [Tiled](https://www.mapeditor.org/) maps for
the virtual office: search an asset catalog, build a `.tmj`, validate it against
the project's conventions, and save it where Tiled and Git can see it.

It runs over **stdio** — no ports, no auth surface, and the process dies with the
session. Its only filesystem access is the repo's `content/` directory.

**Review happens in Tiled, not in-game.** The Phaser migration is a separate
project; until it lands, opening `content/maps/*.tmj` in Tiled is how you see what
was authored, with the real art.

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
        "-e", "ASSET_SOURCE",
        "-e", "ASSET_API_URL",
        "-e", "ASSET_API_KEY",
        "vorkium/map-mcp:dev"
      ]
    }
  }
}
```

`-e ASSET_API_KEY` with no `=value` passes the key through from your shell
environment: it is never written into the image, a compose file, or this repo.

`docker compose up` is *not* how you run it — the MCP client starts one container
per session and talks to it over stdin/stdout. Compose exists to build the image
and to document the runtime contract.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MAP_MCP_WORKSPACE` | `./content` | Absolute path to the workspace root. `/workspace` in the container. |
| `ASSET_SOURCE` | `local` | `local` reads `content/assets/`; `api` calls the asset API. |
| `ASSET_API_URL` | — | Base URL of the asset API. Required when `ASSET_SOURCE=api`. |
| `ASSET_API_KEY` | — | Sent as a header. Never logged, never echoed in a tool result. |
| `MAP_MCP_OFFLINE` | `false` | Refuse all outbound requests. |
| `MAP_MCP_LOG_LEVEL` | `warn` | `silent`/`error`/`warn`/`info`/`debug`, to **stderr** only. |
| `MAP_MCP_MAX_MAP_TILES` | `1000000` | Upper bound on tiles in one map. |

With the defaults the server is fully usable with **no credentials and no
network**: `content/assets/` is the catalog.

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
- **Egress** is pinned to `ASSET_API_URL`. A redirect to another host is refused,
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
- **Contract** — one `AssetRepository` suite that both the local and HTTP
  implementations must pass. This is what keeps the source swappable and the whole
  suite runnable offline.
- **Mocked HTTP** — retry/backoff, 401, 429 with `Retry-After`, ETag 304,
  off-host redirect, oversized payload, corrupt image, key redaction.
- **Round-trip** — a hand-authored, Tiled-saved fixture survives
  parse → serialize → parse unchanged.
- **Validation** — one broken fixture per rule.
- **Integration** — an in-process MCP client running whole flows end to end.
- **Smoke** — the built server over a real stdio transport. Point it at the image
  to test the container:

```bash
MAP_MCP_SMOKE_CMD='docker run --rm -i -v /tmp/ws:/workspace -e MAP_MCP_WORKSPACE=/workspace vorkium/map-mcp:dev' pnpm --filter map-mcp test
```

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
