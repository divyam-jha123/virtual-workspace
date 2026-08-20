# `tilesets/`

Vendored tilesets: `.tsj` files plus the atlas images they reference. Vendored,
not fetched live, for three reasons: Tiled on the host has no API key, Git must
reproduce a map months later, and the game must not load art through a
third-party API.

Populating this from the asset API (`TilesetCache`, `sync_tilesets`, and
`lockfile.json`) is a later branch — today `list_tilesets` reports whatever `.tsj`
files are present here.
