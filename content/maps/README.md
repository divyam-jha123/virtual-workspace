# `maps/`

Canonical Tiled maps in `.tmj` (JSON) form. These are the source of truth and are
meant to be committed. Open them directly in Tiled to review what Claude authored.

Tilesets are referenced **externally** (`"source": "../tilesets/office.tsj"`) so
diffs stay small; the self-contained copy the game loads lives in `runtime/`.
