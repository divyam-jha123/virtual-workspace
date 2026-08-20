import { MapMcpError } from "../errors.js";
import type { Layer, MapModel, MapObject, ObjectLayer, PropertyBag, PropertyValue, TileLayer, TilesetBinding } from "../model/map-model.js";
import { emptyTileData } from "../model/map-model.js";
import { LAYER_KINDS, LAYER_ORDER, LIMITS, TILE_SIZE } from "../schema/index.js";

const TILED_VERSION = "1.11.0";
const MAP_FORMAT_VERSION = "1.10";

/** Keys this adapter models explicitly; anything else on the map object is preserved verbatim. */
const KNOWN_MAP_KEYS = new Set([
  "compressionlevel", "height", "infinite", "layers", "nextlayerid", "nextobjectid",
  "orientation", "properties", "renderorder", "tiledversion", "tileheight", "tilesets",
  "tilewidth", "type", "version", "width",
]);

function fail(message: string, fix: string, path?: string): MapMcpError {
  return new MapMcpError("INVALID_MAP", message, { rule: "tmj-parse", fix, ...(path ? { path } : {}) });
}

function propertyType(value: PropertyValue): "string" | "int" | "float" | "bool" {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  return "string";
}

export function parseProperties(raw: unknown): PropertyBag {
  const bag: PropertyBag = {};
  if (!Array.isArray(raw)) return bag;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { name, value } = entry as { name?: unknown; value?: unknown };
    if (typeof name !== "string") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") bag[name] = value;
  }
  return bag;
}

export function serializeProperties(bag: PropertyBag): Array<{ name: string; type: string; value: PropertyValue }> | undefined {
  const names = Object.keys(bag).sort();
  if (names.length === 0) return undefined;
  return names.map((name) => ({ name, type: propertyType(bag[name]!), value: bag[name]! }));
}

/**
 * Reads a Tiled `.tmj` into a `MapModel`, rejecting anything the runtime cannot
 * load with a diagnostic that says how to fix it rather than a stack trace.
 */
export function parseTmj(payload: unknown, path?: string): MapModel {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw fail("Map file is not a JSON object", "Recreate the map with create_map, or repair it in Tiled.", path);
  }
  const raw = payload as Record<string, unknown>;

  if (raw.type !== undefined && raw.type !== "map") {
    throw fail(`Expected a Tiled map, got type "${String(raw.type)}"`, "Point read_map at a .tmj map file, not a tileset.", path);
  }
  if (raw.infinite === true) {
    throw fail("Infinite maps are not supported", "In Tiled: Map -> Map Properties -> uncheck Infinite, then resave.", path);
  }
  if (raw.orientation !== undefined && raw.orientation !== "orthogonal") {
    throw fail(`Unsupported orientation "${String(raw.orientation)}"`, "Only orthogonal maps are supported.", path);
  }

  const width = intField(raw.width, "width", path);
  const height = intField(raw.height, "height", path);
  const tileWidth = intField(raw.tilewidth, "tilewidth", path);
  const tileHeight = intField(raw.tileheight, "tileheight", path);

  const tilesets: TilesetBinding[] = [];
  for (const entry of Array.isArray(raw.tilesets) ? raw.tilesets : []) {
    if (!entry || typeof entry !== "object") continue;
    const tileset = entry as Record<string, unknown>;
    const source = tileset.source;
    if (typeof source !== "string") {
      throw fail(
        "Embedded tilesets are not supported in an authoring map",
        "Bind tilesets externally with add_tileset so diffs stay small; embedding happens only in the exported runtime bundle.",
        path,
      );
    }
    tilesets.push({
      firstgid: intField(tileset.firstgid, "tilesets[].firstgid", path),
      source,
      id: tilesetIdFromSource(source),
      tileCount: typeof tileset.tilecount === "number" ? tileset.tilecount : 0,
    });
  }

  const layers: Layer[] = [];
  for (const entry of Array.isArray(raw.layers) ? raw.layers : []) {
    layers.push(parseLayer(entry, { width, height }, path));
  }

  const unknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (!KNOWN_MAP_KEYS.has(key)) unknown[key] = value;

  const maxLayerId = layers.reduce((max, layer) => Math.max(max, layer.id), 0);
  const maxObjectId = layers.reduce(
    (max, layer) => (layer.kind === "objectgroup" ? layer.objects.reduce((m, o) => Math.max(m, o.id), max) : max),
    0,
  );

  return {
    width,
    height,
    tileWidth,
    tileHeight,
    infinite: false,
    orientation: "orthogonal",
    renderOrder: "right-down",
    layers,
    tilesets,
    properties: parseProperties(raw.properties),
    nextLayerId: Math.max(numberOr(raw.nextlayerid, 0), maxLayerId + 1),
    nextObjectId: Math.max(numberOr(raw.nextobjectid, 0), maxObjectId + 1),
    unknown,
  };
}

function parseLayer(entry: unknown, size: { width: number; height: number }, path?: string): Layer {
  if (!entry || typeof entry !== "object") throw fail("A layer entry is not an object", "Repair the map in Tiled.", path);
  const raw = entry as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name : "";
  const type = raw.type;

  if (type === "imagelayer") {
    throw fail(`Layer "${name}" is an image layer`, "Image layers are not loadable by the runtime; delete it or convert it to a tile layer.", path);
  }
  if (type === "group") {
    throw fail(`Layer "${name}" is a group layer`, "Flatten group layers in Tiled; the runtime loads a flat layer stack.", path);
  }

  const common = {
    id: numberOr(raw.id, 0),
    name,
    visible: raw.visible !== false,
    opacity: typeof raw.opacity === "number" ? raw.opacity : 1,
    properties: parseProperties(raw.properties),
  };

  if (type === "objectgroup") {
    const objects: MapObject[] = [];
    for (const objectEntry of Array.isArray(raw.objects) ? raw.objects : []) {
      if (!objectEntry || typeof objectEntry !== "object") continue;
      const object = objectEntry as Record<string, unknown>;
      const parsed: MapObject = {
        id: numberOr(object.id, 0),
        name: typeof object.name === "string" ? object.name : "",
        // Tiled 1.9+ writes "class"; older files wrote "type".
        class: typeof object.class === "string" ? object.class : typeof object.type === "string" ? object.type : "",
        x: numberOr(object.x, 0),
        y: numberOr(object.y, 0),
        width: numberOr(object.width, 0),
        height: numberOr(object.height, 0),
        rotation: numberOr(object.rotation, 0),
        visible: object.visible !== false,
        properties: parseProperties(object.properties),
      };
      if (typeof object.gid === "number") parsed.gid = object.gid;
      if (object.point === true) parsed.point = true;
      objects.push(parsed);
    }
    return { ...common, kind: "objectgroup", objects } satisfies ObjectLayer;
  }

  if (type !== "tilelayer") {
    throw fail(`Layer "${name}" has unsupported type "${String(type)}"`, "Only tilelayer and objectgroup layers are supported.", path);
  }

  const encoding = raw.encoding;
  if (encoding !== undefined && encoding !== "csv") {
    throw fail(
      `Layer "${name}" uses "${String(encoding)}" encoding`,
      "In Tiled: Edit -> Preferences -> General -> Tile layer format = CSV, then resave.",
      path,
    );
  }
  if (!Array.isArray(raw.data)) {
    throw fail(`Layer "${name}" has no plain tile data array`, "Save the map with CSV tile layer format so `data` is a plain array.", path);
  }

  const layerWidth = numberOr(raw.width, size.width);
  const layerHeight = numberOr(raw.height, size.height);
  const data = (raw.data as unknown[]).map((value) => (typeof value === "number" ? value : 0));
  if (data.length !== layerWidth * layerHeight) {
    throw fail(
      `Layer "${name}" has ${data.length} tiles but is ${layerWidth}x${layerHeight}`,
      "Resave the map in Tiled so the layer data matches the layer size.",
      path,
    );
  }

  return { ...common, kind: "tilelayer", width: layerWidth, height: layerHeight, data } satisfies TileLayer;
}

/**
 * Writes a `MapModel` back to Tiled JSON with a stable key order, so a no-op
 * edit produces a zero-line diff.
 */
export function serializeTmj(model: MapModel): Record<string, unknown> {
  const map: Record<string, unknown> = {
    ...model.unknown,
    compressionlevel: -1,
    height: model.height,
    infinite: false,
    layers: model.layers.map(serializeLayer),
    nextlayerid: model.nextLayerId,
    nextobjectid: model.nextObjectId,
    orientation: "orthogonal",
    renderorder: "right-down",
    tiledversion: TILED_VERSION,
    tileheight: model.tileHeight,
    tilesets: [...model.tilesets]
      .sort((a, b) => a.firstgid - b.firstgid)
      .map((tileset) => ({ firstgid: tileset.firstgid, source: tileset.source })),
    tilewidth: model.tileWidth,
    type: "map",
    version: MAP_FORMAT_VERSION,
    width: model.width,
  };
  const properties = serializeProperties(model.properties);
  if (properties) map.properties = properties;
  return sortKeys(map);
}

function serializeLayer(layer: Layer): Record<string, unknown> {
  const common: Record<string, unknown> = {
    id: layer.id,
    name: layer.name,
    opacity: layer.opacity,
    visible: layer.visible,
    x: 0,
    y: 0,
  };
  const properties = serializeProperties(layer.properties);
  if (properties) common.properties = properties;

  if (layer.kind === "tilelayer") {
    return sortKeys({ ...common, data: layer.data, height: layer.height, type: "tilelayer", width: layer.width });
  }
  return sortKeys({
    ...common,
    draworder: "topdown",
    objects: layer.objects.map(serializeObject),
    type: "objectgroup",
  });
}

function serializeObject(object: MapObject): Record<string, unknown> {
  const out: Record<string, unknown> = {
    height: object.height,
    id: object.id,
    name: object.name,
    rotation: object.rotation,
    visible: object.visible,
    width: object.width,
    x: object.x,
    y: object.y,
  };
  if (object.class !== "") out.class = object.class;
  if (object.gid !== undefined) out.gid = object.gid;
  if (object.point) out.point = true;
  const properties = serializeProperties(object.properties);
  if (properties) out.properties = properties;
  return sortKeys(out);
}

/** Alphabetical key order at every level — the same order Tiled itself writes. */
function sortKeys<T extends Record<string, unknown>>(value: T): T {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return sorted as T;
}

export function tilesetIdFromSource(source: string): string {
  const base = source.split("/").pop() ?? source;
  return base.toLowerCase().endsWith(".tsj") ? base.slice(0, -4) : base;
}

/** A fresh map with the standard layer stack, ready to be filled in. */
export function createEmptyMap(options: {
  width: number;
  height: number;
  tileSize?: number;
  name?: string;
  description?: string;
}): MapModel {
  const tileSize = options.tileSize ?? TILE_SIZE;
  if (options.width < 1 || options.height < 1 || options.width > LIMITS.maxWidth || options.height > LIMITS.maxHeight) {
    throw new MapMcpError("INVALID_ARGUMENT", `Map size ${options.width}x${options.height} is out of bounds`, {
      rule: "map-dimensions",
      fix: `Width and height must be between 1 and ${LIMITS.maxWidth}.`,
    });
  }

  const layers: Layer[] = LAYER_ORDER.map((name, index) => {
    const base = { id: index + 1, name, visible: true, opacity: 1, properties: {} as PropertyBag };
    return LAYER_KINDS[name] === "tilelayer"
      ? ({ ...base, kind: "tilelayer", width: options.width, height: options.height, data: emptyTileData(options.width, options.height) } satisfies TileLayer)
      : ({ ...base, kind: "objectgroup", objects: [] } satisfies ObjectLayer);
  });

  const properties: PropertyBag = {};
  if (options.name) properties.name = options.name;
  if (options.description) properties.description = options.description;

  return {
    width: options.width,
    height: options.height,
    tileWidth: tileSize,
    tileHeight: tileSize,
    infinite: false,
    orientation: "orthogonal",
    renderOrder: "right-down",
    layers,
    tilesets: [],
    properties,
    nextLayerId: LAYER_ORDER.length + 1,
    nextObjectId: 1,
    unknown: {},
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function intField(value: unknown, field: string, path?: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw fail(`Map field "${field}" is missing or not a positive number`, "Resave the map in Tiled, or recreate it with create_map.", path);
  }
  return Math.trunc(value);
}
