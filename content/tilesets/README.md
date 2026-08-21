# `tilesets/`

Vendored tilesets: `.tsj` files plus the atlas images they reference. On disk, not
fetched live, for three reasons: Tiled on the host opens them directly, Git must
reproduce a map months later, and the game loads art from the filesystem, never
through a third-party API.

Add a tileset by dropping both files here:

```
content/tilesets/<pack>.tsj    <- Tiled tileset (New Tileset… → Based on Tileset Image)
content/tilesets/<pack>.png    <- the atlas image the .tsj names
```

Both must be present — a `.tsj` whose image is missing is a save-blocking error,
because the map would open blank in Tiled.

`list_tilesets` reports whatever `.tsj` files are present here, and `vendored: true`
means exactly that. There is no asset service and nothing to register: the MCP
discovers tilesets by scanning this folder.
