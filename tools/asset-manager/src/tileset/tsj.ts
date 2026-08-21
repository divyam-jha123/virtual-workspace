import { sanitizeFilename } from "../lib/filenames.js";

/** Opaque Tiled tileset JSON. We author it but keep the shape loose. */
export type TilesetJson = Record<string, unknown>;

/** Every image a `.tsj` references — the single atlas plus any per-tile images. */
export function imageReferences(tsj: TilesetJson): string[] {
  const found = new Set<string>();
  if (typeof tsj.image === "string") found.add(tsj.image);
  if (Array.isArray(tsj.tiles)) {
    for (const tile of tsj.tiles) {
      const image = (tile as { image?: unknown })?.image;
      if (typeof image === "string") found.add(image);
    }
  }
  return [...found];
}

/**
 * Produce the `.tsj` the MCP and Tiled will use once the tileset is vendored:
 *
 *  - image references are reduced to basenames, because vendoring colocates every
 *    image beside the `.tsj` in content/tilesets/ and the MCP resolves images by
 *    basename (map-service.ts). The relative paths in the stored/original `.tsj`
 *    are left untouched — this is a copy, not a rewrite of the source file.
 *  - `tilewidth`/`tileheight` are forced to the map grid size (16). For a
 *    collection tileset the declared tile size is only a bounding-box default;
 *    each tile still renders at its own image size. Without this the MCP's
 *    validator rejects the tileset on a 16px map (validator.ts: tileset-tile-size).
 */
export function normalizeTsjForVendor(tsj: TilesetJson, tileGrid = 16): TilesetJson {
  const out: TilesetJson = { ...tsj, tilewidth: tileGrid, tileheight: tileGrid };
  if (typeof out.image === "string") out.image = sanitizeFilename(out.image);
  if (Array.isArray(out.tiles)) {
    out.tiles = out.tiles.map((tile) => {
      if (tile && typeof tile === "object" && typeof (tile as { image?: unknown }).image === "string") {
        return { ...(tile as object), image: sanitizeFilename((tile as { image: string }).image) };
      }
      return tile;
    });
  }
  return out;
}
