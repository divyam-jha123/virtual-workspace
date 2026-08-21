# `tilesets/`

Vendored tilesets: `.tsj` files plus the atlas images they reference. Vendored,
not fetched live, for three reasons: Tiled on the host has no API key, Git must
reproduce a map months later, and the game must not load art through a
third-party API.

Files land here two ways, and both write the same bytes:

- **Pulled** by `sync_tilesets`, or automatically by `place_asset` when the art a
  placement needs is not on disk yet. This is the normal path.
- **Pushed** by the Asset Manager's vendor step (`pnpm vendor` in
  `tools/asset-manager`), which writes the same `.tsj` and images directly.

Either way the result is a real file, which is the only thing Tiled and the game
can open. `list_tilesets` reports whatever `.tsj` files are present here, and
`vendored: true` means exactly that.

`asset-manager.lock.json` records a sha256 of everything the push path wrote, so a
map can be reproduced later.
