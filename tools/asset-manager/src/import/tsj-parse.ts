import { badRequest } from "../lib/errors.js";
import { sanitizeFilename } from "../lib/filenames.js";
import type { TilesetSpec, TilesetTileSpec } from "./spec.js";

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Parse an uploaded Tiled `.tsj` (JSON) into a normalized TilesetSpec. */
export function specFromTsj(json: unknown): TilesetSpec {
  if (!json || typeof json !== "object") throw badRequest("bad-tsj", "Tileset JSON is not an object.");
  const t = json as Record<string, unknown>;
  const name = typeof t.name === "string" ? t.name : "tileset";
  const tileWidth = num(t.tilewidth, 16);
  const tileHeight = num(t.tileheight, 16);

  if (Array.isArray(t.tiles) && t.tiles.some((x) => (x as { image?: unknown })?.image)) {
    const tiles: TilesetTileSpec[] = [];
    for (const raw of t.tiles) {
      const tile = raw as Record<string, unknown>;
      if (typeof tile.image !== "string") continue;
      tiles.push({
        id: num(tile.id, tiles.length),
        image: sanitizeFilename(tile.image),
        width: num(tile.imagewidth, tileWidth),
        height: num(tile.imageheight, tileHeight),
      });
    }
    return { name, kind: "collection", tileWidth, tileHeight, columns: 0, tileCount: Math.max(num(t.tilecount), tiles.length), tiles };
  }

  if (typeof t.image !== "string") throw badRequest("bad-tsj", `Tileset "${name}" has no atlas image and no tile images.`);
  return {
    name,
    kind: "grid",
    tileWidth,
    tileHeight,
    columns: num(t.columns),
    tileCount: num(t.tilecount),
    image: sanitizeFilename(t.image),
    imageWidth: num(t.imagewidth),
    imageHeight: num(t.imageheight),
    tiles: [],
  };
}
