# `content/` — the map-design workspace

This directory is the **only** thing mounted into the `map-mcp` container
(`-v ./content:/workspace`). The MCP server can read and write here and nowhere
else; it never sees `apps/`, `.env`, or `.git`.

| Directory | Contents | Written by |
|---|---|---|
| `maps/` | canonical Tiled maps (`.tmj`) — commit these | MCP + humans (Tiled) |
| `tilesets/` | vendored tilesets (`.tsj`) and their atlas images | MCP (`TilesetCache`, later branch) |
| `assets/` | local asset library — the default, no-network asset source | you, by hand |
| `schemas/` | published JSON Schema for the map contract | MCP |
| `runtime/` | exported Phaser-loadable bundles (build artifacts) | MCP |
| `.map-mcp/` | drafts, snapshots, `status.json`, HTTP cache — not committed | MCP |

Paths are always **workspace-relative ids** (`maps/hq.tmj`), never absolute.
Anything outside this tree, and any `..` or escaping symlink, is rejected.
