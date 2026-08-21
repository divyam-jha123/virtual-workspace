import { XMLParser } from "fast-xml-parser";
import { badRequest } from "../lib/errors.js";
import { sanitizeFilename } from "../lib/filenames.js";
import type { TilesetSpec, TilesetTileSpec } from "./spec.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "tile",
});

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Parse a Tiled XML `.tsx` into a normalized TilesetSpec. Handles both a single
 * grid atlas (`<image>` child) and an image-collection tileset (`columns="0"`
 * with per-tile `<image>` children). Image `source` paths are reduced to
 * basenames; the original relative path is never trusted or followed.
 */
export function parseTsx(xml: string): TilesetSpec {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw badRequest("bad-tsx", `Could not parse .tsx XML: ${(err as Error).message}`);
  }
  const tileset = doc.tileset as Record<string, unknown> | undefined;
  if (!tileset) throw badRequest("bad-tsx", "No <tileset> element in the .tsx file.");

  const name = String(tileset["@_name"] ?? "tileset");
  const tileWidth = num(tileset["@_tilewidth"], 16);
  const tileHeight = num(tileset["@_tileheight"], 16);
  const declaredCount = num(tileset["@_tilecount"], 0);
  const columns = num(tileset["@_columns"], 0);

  // Collection tileset: per-tile <tile><image/></tile>.
  const tileNodes = tileset.tile as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tileNodes) && tileNodes.length > 0 && tileNodes.some((t) => t.image)) {
    const tiles: TilesetTileSpec[] = [];
    for (const node of tileNodes) {
      const image = node.image as Record<string, unknown> | undefined;
      if (!image?.["@_source"]) continue;
      tiles.push({
        id: num(node["@_id"], tiles.length),
        image: sanitizeFilename(String(image["@_source"])),
        width: num(image["@_width"], tileWidth),
        height: num(image["@_height"], tileHeight),
      });
    }
    return {
      name,
      kind: "collection",
      tileWidth,
      tileHeight,
      columns: 0,
      tileCount: Math.max(declaredCount, tiles.length),
      tiles,
    };
  }

  // Grid tileset: single <image> child.
  const image = tileset.image as Record<string, unknown> | undefined;
  if (!image?.["@_source"]) throw badRequest("bad-tsx", `Tileset "${name}" has neither an atlas image nor tile images.`);
  const imageWidth = num(image["@_width"]);
  const imageHeight = num(image["@_height"]);
  const cols = columns > 0 ? columns : tileWidth > 0 ? Math.floor(imageWidth / tileWidth) : 0;
  const rows = tileHeight > 0 ? Math.floor(imageHeight / tileHeight) : 0;
  return {
    name,
    kind: "grid",
    tileWidth,
    tileHeight,
    columns: cols,
    tileCount: declaredCount > 0 ? declaredCount : cols * rows,
    image: sanitizeFilename(String(image["@_source"])),
    imageWidth,
    imageHeight,
    tiles: [],
  };
}
