/** Transport-agnostic description of a tileset, produced by the .tsx/.tsj
 *  parsers and consumed by ingest. Image references are basenames. */
export interface TilesetTileSpec {
  id: number;
  image: string;
  width: number;
  height: number;
}

export interface TilesetSpec {
  name: string;
  kind: "grid" | "collection";
  tileWidth: number;
  tileHeight: number;
  columns: number;
  tileCount: number;
  /** Single atlas image basename (grid only). */
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  /** Per-tile images (collection only). */
  tiles: TilesetTileSpec[];
}

/** Build the canonical Tiled `.tsj` JSON for a spec. Image refs are basenames so
 *  that once vendored (colocated) they resolve; the map grid stays authoritative
 *  only after normalizeTsjForVendor forces tilewidth/height to 16. Here we keep
 *  the spec's real values so the inspector can show true sizes. */
export function specToTsj(spec: TilesetSpec): Record<string, unknown> {
  const common = {
    name: spec.name,
    tilewidth: spec.tileWidth,
    tileheight: spec.tileHeight,
    tilecount: spec.tileCount,
    margin: 0,
    spacing: 0,
    type: "tileset",
    version: "1.10",
    tiledversion: "1.10.2",
  };
  if (spec.kind === "grid" && spec.image) {
    return {
      ...common,
      columns: spec.columns,
      image: spec.image,
      imagewidth: spec.imageWidth ?? 0,
      imageheight: spec.imageHeight ?? 0,
    };
  }
  return {
    ...common,
    columns: 0,
    grid: { orientation: "orthogonal", width: 1, height: 1 },
    tiles: spec.tiles.map((t) => ({ id: t.id, image: t.image, imagewidth: t.width, imageheight: t.height })),
  };
}
