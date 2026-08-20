/**
 * The internal map model. Deliberately NOT the wire format: services reason
 * about this shape, and `TiledAdapter` is the only thing that knows how it maps
 * onto `.tmj` JSON.
 */

export type PropertyValue = string | number | boolean;

export type PropertyBag = Record<string, PropertyValue>;

export interface TilesetBinding {
  firstgid: number;
  /** Path as written in the `.tmj`, e.g. "../tilesets/office-core.tsj". */
  source: string;
  /** Tileset id — the `.tsj` basename. */
  id: string;
  /** Tiles in the set, used for gid range checks. 0 when unknown. */
  tileCount: number;
  tileWidth?: number;
  tileHeight?: number;
}

export interface TileLayer {
  kind: "tilelayer";
  id: number;
  name: string;
  width: number;
  height: number;
  /** Dense, row-major, length width*height. 0 means empty. */
  data: number[];
  visible: boolean;
  opacity: number;
  properties: PropertyBag;
}

export interface MapObject {
  id: number;
  name: string;
  /** Object class from the map schema; "" when unclassified. */
  class: string;
  /** Pixels. For gid objects this is the bottom-left corner, as Tiled stores it. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  /** Set when the object is a tile object drawn from a tileset. */
  gid?: number;
  point?: boolean;
  properties: PropertyBag;
}

export interface ObjectLayer {
  kind: "objectgroup";
  id: number;
  name: string;
  objects: MapObject[];
  visible: boolean;
  opacity: number;
  properties: PropertyBag;
}

export type Layer = TileLayer | ObjectLayer;

export interface MapModel {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  infinite: false;
  orientation: "orthogonal";
  renderOrder: "right-down";
  layers: Layer[];
  tilesets: TilesetBinding[];
  properties: PropertyBag;
  nextLayerId: number;
  nextObjectId: number;
  /** Keys the file carried that this model does not model; preserved on write. */
  unknown: Record<string, unknown>;
}

export function isTileLayer(layer: Layer): layer is TileLayer {
  return layer.kind === "tilelayer";
}

export function isObjectLayer(layer: Layer): layer is ObjectLayer {
  return layer.kind === "objectgroup";
}

export function findLayer(model: MapModel, name: string): Layer | undefined {
  return model.layers.find((layer) => layer.name === name);
}

export function allObjects(model: MapModel): Array<{ layer: ObjectLayer; object: MapObject }> {
  const out: Array<{ layer: ObjectLayer; object: MapObject }> = [];
  for (const layer of model.layers) {
    if (isObjectLayer(layer)) for (const object of layer.objects) out.push({ layer, object });
  }
  return out;
}

export function emptyTileData(width: number, height: number): number[] {
  return new Array<number>(width * height).fill(0);
}

/** Deep-enough clone for snapshots and drafts; the model holds only plain data. */
export function cloneMap(model: MapModel): MapModel {
  return structuredClone(model);
}
