import type { Diagnostic } from "../errors.js";
import type { MapModel, MapObject, ObjectLayer, TileLayer } from "../model/map-model.js";
import { allObjects, isObjectLayer, isTileLayer } from "../model/map-model.js";
import { LAYER_KINDS, LAYER_ORDER, LIMITS, REQUIRED_LAYERS, TILE_SIZE, getObjectClassSpec, isLayerName, OBJECT_CLASS_NAMES } from "../schema/index.js";

export interface ValidationContext {
  /** Tileset ids that exist as a `.tsj` file in the workspace. */
  vendoredTilesets?: Set<string>;
  /** Per-tileset tile counts, for gid range checks. */
  tileCounts?: Map<string, number>;
  /** Per-tileset tile size, to catch a 16px set on a 32px map. */
  tileSizes?: Map<string, number>;
}

export interface ValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  summary: string;
}

type Rule = (model: MapModel, context: ValidationContext) => Diagnostic[];

function error(rule: string, message: string, fix: string, path?: string): Diagnostic {
  return { severity: "error", rule, message, fix, ...(path ? { path } : {}) };
}

function warn(rule: string, message: string, fix: string, path?: string): Diagnostic {
  return { severity: "warning", rule, message, fix, ...(path ? { path } : {}) };
}

// ---------------------------------------------------------------- structure

const requiredLayers: Rule = (model) => {
  const present = new Set(model.layers.map((layer) => layer.name));
  return REQUIRED_LAYERS.filter((name) => !present.has(name)).map((name) =>
    error("layer-missing", `Required layer "${name}" is missing`, `Call add_layer with name "${name}".`, `layers/${name}`),
  );
};

const layerKinds: Rule = (model) =>
  model.layers.flatMap((layer) => {
    if (!isLayerName(layer.name)) {
      return [warn("layer-unknown", `Layer "${layer.name}" is not part of the map schema`, `Known layers: ${LAYER_ORDER.join(", ")}.`, `layers/${layer.name}`)];
    }
    const expected = LAYER_KINDS[layer.name];
    return layer.kind === expected
      ? []
      : [error("layer-kind", `Layer "${layer.name}" is a ${layer.kind}, expected ${expected}`, `Delete it and re-add it with add_layer.`, `layers/${layer.name}`)];
  });

const layerOrder: Rule = (model) => {
  const known = model.layers.filter((layer) => isLayerName(layer.name));
  const indices = known.map((layer) => LAYER_ORDER.indexOf(layer.name as (typeof LAYER_ORDER)[number]));
  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i]! < indices[i - 1]!) {
      return [
        error(
          "layer-order",
          `Layer "${known[i]!.name}" appears before "${known[i - 1]!.name}", which breaks the render order`,
          `Reorder layers bottom-to-top: ${LAYER_ORDER.join(" -> ")}.`,
          `layers/${known[i]!.name}`,
        ),
      ];
    }
  }
  return [];
};

const dimensions: Rule = (model) => {
  const diagnostics: Diagnostic[] = [];
  if (model.width < 1 || model.height < 1 || model.width > LIMITS.maxWidth || model.height > LIMITS.maxHeight) {
    diagnostics.push(
      error("map-dimensions", `Map is ${model.width}x${model.height}, outside 1..${LIMITS.maxWidth}`, `Recreate the map within the size limits.`),
    );
  }
  if (model.tileWidth !== TILE_SIZE || model.tileHeight !== TILE_SIZE) {
    diagnostics.push(
      error(
        "tile-size",
        `Map tile size is ${model.tileWidth}x${model.tileHeight}, project convention is ${TILE_SIZE}`,
        `Set tilewidth and tileheight to ${TILE_SIZE}.`,
      ),
    );
  }
  for (const layer of model.layers) {
    if (isTileLayer(layer) && (layer.width !== model.width || layer.height !== model.height)) {
      diagnostics.push(
        error(
          "layer-size",
          `Layer "${layer.name}" is ${layer.width}x${layer.height} but the map is ${model.width}x${model.height}`,
          "Resave the map in Tiled so every tile layer matches the map size.",
          `layers/${layer.name}`,
        ),
      );
    }
  }
  if (model.layers.length > LIMITS.maxLayers) {
    diagnostics.push(error("layer-count", `Map has ${model.layers.length} layers, over the ${LIMITS.maxLayers} limit`, "Remove unused layers."));
  }
  return diagnostics;
};

// ----------------------------------------------------------------- tilesets

const tilesetsResolve: Rule = (model, context) => {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<number, string>();

  for (const tileset of model.tilesets) {
    const previous = seen.get(tileset.firstgid);
    if (previous) {
      diagnostics.push(
        error("firstgid-collision", `Tilesets "${previous}" and "${tileset.id}" both claim firstgid ${tileset.firstgid}`, "Re-bind one of them with add_tileset so gid ranges do not overlap."),
      );
    }
    seen.set(tileset.firstgid, tileset.id);

    if (context.vendoredTilesets && !context.vendoredTilesets.has(tileset.id)) {
      diagnostics.push(
        error(
          "tileset-not-vendored",
          `Tileset "${tileset.id}" is referenced as ${tileset.source} but no such file exists`,
          "Drop the .tsj and its atlas into content/tilesets/, or re-bind the map to a vendored tileset. Tiled cannot open the map until this resolves.",
        ),
      );
    }

    const tilesetTileSize = context.tileSizes?.get(tileset.id);
    if (tilesetTileSize !== undefined && tilesetTileSize !== model.tileWidth) {
      diagnostics.push(
        error(
          "tileset-tile-size",
          `Tileset "${tileset.id}" is drawn for ${tilesetTileSize}px tiles but the map uses ${model.tileWidth}px`,
          "Use a tileset authored for the map's tile size; art will not line up otherwise.",
        ),
      );
    }
  }

  const maxGid = maxKnownGid(model, context);
  const offenders = new Set<string>();
  for (const layer of model.layers) {
    if (!isTileLayer(layer)) continue;
    for (const raw of layer.data) {
      const gid = stripFlags(raw);
      if (gid === 0) continue;
      if (!resolves(gid, model, context)) offenders.add(layer.name);
    }
  }
  for (const layerName of offenders) {
    diagnostics.push(
      error(
        "gid-unresolved",
        `Layer "${layerName}" contains tile ids that no bound tileset provides${maxGid > 0 ? ` (highest valid gid is ${maxGid})` : ""}`,
        "Bind the missing tileset with add_tileset, or clear those tiles with place_tiles.",
        `layers/${layerName}`,
      ),
    );
  }

  for (const { layer, object } of allObjects(model)) {
    if (object.gid !== undefined && !resolves(stripFlags(object.gid), model, context)) {
      diagnostics.push(
        error("gid-unresolved", `Object ${object.id} on "${layer.name}" uses an unresolvable tile id`, "Re-place the asset with place_asset.", objectPath(layer, object)),
      );
    }
  }

  return diagnostics;
};

// ------------------------------------------------------------------ objects

const objectsValid: Rule = (model) => {
  const diagnostics: Diagnostic[] = [];
  const ids = new Map<number, string>();

  for (const { layer, object } of allObjects(model)) {
    const path = objectPath(layer, object);

    const duplicate = ids.get(object.id);
    if (duplicate) {
      diagnostics.push(error("object-id-duplicate", `Object id ${object.id} is used on both "${duplicate}" and "${layer.name}"`, "Remove and re-add one of them so it gets a fresh id.", path));
    }
    ids.set(object.id, layer.name);

    if (object.class === "") {
      diagnostics.push(warn("object-unclassified", `Object ${object.id} on "${layer.name}" has no class`, `Set one of: ${OBJECT_CLASS_NAMES.join(", ")}.`, path));
      continue;
    }

    const spec = getObjectClassSpec(object.class);
    if (!spec) {
      diagnostics.push(error("object-class-unknown", `Object ${object.id} has unknown class "${object.class}"`, `Known classes: ${OBJECT_CLASS_NAMES.join(", ")}.`, path));
      continue;
    }

    if (!(spec.layers as readonly string[]).includes(layer.name)) {
      diagnostics.push(
        warn(
          "object-layer",
          `A "${object.class}" belongs on ${spec.layers.map((name) => `"${name}"`).join(" or ")}, not "${layer.name}"`,
          `Move it onto "${spec.layers[0]}".`,
          path,
        ),
      );
    }

    for (const [name, propertySpec] of Object.entries(spec.properties)) {
      const value = object.properties[name];
      if (value === undefined) {
        if (propertySpec.required) {
          diagnostics.push(error("property-missing", `"${object.class}" object ${object.id} is missing required property "${name}"`, `Call set_property with ${name} (${propertySpec.type}).`, path));
        }
        continue;
      }
      const typeError = checkType(value, propertySpec.type);
      if (typeError) {
        diagnostics.push(error("property-type", `Property "${name}" on object ${object.id} ${typeError}`, `Set it to a ${propertySpec.type} value.`, path));
      }
      if (propertySpec.enum && !propertySpec.enum.includes(String(value))) {
        diagnostics.push(error("property-enum", `Property "${name}" on object ${object.id} is "${String(value)}"`, `Allowed values: ${propertySpec.enum.join(", ")}.`, path));
      }
    }

    for (const name of Object.keys(object.properties)) {
      if (!(name in spec.properties)) {
        diagnostics.push(warn("property-unknown", `Property "${name}" is not part of the "${object.class}" class`, "Remove it, or extend the schema deliberately.", path));
      }
    }

    if (!withinBounds(object, model)) {
      diagnostics.push(error("object-out-of-bounds", `Object ${object.id} lies outside the ${model.width}x${model.height} map`, "Move it inside the map with move_object.", path));
    }
  }

  if (ids.size > LIMITS.maxObjectsPerMap) {
    diagnostics.push(error("object-count", `Map has ${ids.size} objects, over the ${LIMITS.maxObjectsPerMap} limit`, "Split the map, or remove unused objects."));
  }

  return diagnostics;
};

// ----------------------------------------------------------------- gameplay

const spawns: Rule = (model) => {
  const spawnObjects = allObjects(model)
    .map(({ object }) => object)
    .filter((object) => object.class === "spawn");

  if (spawnObjects.length === 0) {
    return [error("spawn-missing", "Map has no spawn point", 'Add one with add_object class "spawn" and property default=true.', "layers/SpawnPoints")];
  }

  const defaults = spawnObjects.filter((object) => object.properties.default === true);
  if (defaults.length === 0) {
    return [error("spawn-default-missing", `Map has ${spawnObjects.length} spawn(s) but none is the default`, "Set default=true on exactly one spawn.", "layers/SpawnPoints")];
  }
  if (defaults.length > 1) {
    return [
      error(
        "spawn-default-duplicate",
        `Map has ${defaults.length} default spawns (${defaults.map((s) => s.properties.id ?? s.id).join(", ")})`,
        "Exactly one spawn may have default=true.",
        "layers/SpawnPoints",
      ),
    ];
  }
  return [];
};

const spawnWalkable: Rule = (model) => {
  const collision = model.layers.find((layer) => layer.name === "Collision");
  if (!collision || !isTileLayer(collision)) return [];

  return allObjects(model)
    .filter(({ object }) => object.class === "spawn")
    .flatMap(({ layer, object }) => {
      const tile = tileOf(object, model);
      if (tile.x < 0 || tile.y < 0 || tile.x >= model.width || tile.y >= model.height) return [];
      const blocked = collision.data[tile.y * model.width + tile.x] !== 0;
      return blocked
        ? [error("spawn-blocked", `Spawn ${object.properties.id ?? object.id} sits on a blocked tile (${tile.x}, ${tile.y})`, "Move the spawn to a walkable tile, or clear that Collision tile.", objectPath(layer, object))]
        : [];
    });
};

/** Flood-fill from the default spawn; anything unreachable is dead level design. */
const reachability: Rule = (model) => {
  const collision = model.layers.find((layer) => layer.name === "Collision");
  const ground = model.layers.find((layer) => layer.name === "Ground");
  if (!collision || !isTileLayer(collision) || !ground || !isTileLayer(ground)) return [];

  const defaultSpawn = allObjects(model).find(({ object }) => object.class === "spawn" && object.properties.default === true);
  if (!defaultSpawn) return [];

  const start = tileOf(defaultSpawn.object, model);
  if (start.x < 0 || start.y < 0 || start.x >= model.width || start.y >= model.height) return [];

  const blocked = (x: number, y: number) => collision.data[y * model.width + x] !== 0;
  const floored = (x: number, y: number) => ground.data[y * model.width + x] !== 0;
  if (blocked(start.x, start.y)) return [];

  const seen = new Uint8Array(model.width * model.height);
  const queue: Array<[number, number]> = [[start.x, start.y]];
  seen[start.y * model.width + start.x] = 1;
  let reached = 0;

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    reached += 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= model.width || ny >= model.height) continue;
      const index = ny * model.width + nx;
      if (seen[index] || blocked(nx, ny)) continue;
      seen[index] = 1;
      queue.push([nx, ny]);
    }
  }

  let walkable = 0;
  for (let y = 0; y < model.height; y += 1) {
    for (let x = 0; x < model.width; x += 1) if (!blocked(x, y) && floored(x, y)) walkable += 1;
  }
  if (walkable === 0 || reached >= walkable) return [];

  return [
    warn(
      "unreachable-area",
      `${walkable - reached} floored tile(s) cannot be reached from the default spawn`,
      "Add a door or clear the wall between the isolated area and the rest of the map.",
    ),
  ];
};

const zoneOverlap: Rule = (model) => {
  const zones = allObjects(model).filter(({ object }) => object.class === "interaction-zone");
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      const a = zones[i]!;
      const b = zones[j]!;
      if (a.object.properties.kind !== b.object.properties.kind && overlaps(a.object, b.object)) {
        diagnostics.push(
          warn(
            "zone-overlap",
            `Interaction zones "${a.object.properties.id ?? a.object.id}" (${String(a.object.properties.kind)}) and "${b.object.properties.id ?? b.object.id}" (${String(b.object.properties.kind)}) overlap`,
            "Overlapping zones of different kinds fire both callbacks; separate them, or confirm that is intended.",
            objectPath(a.layer, a.object),
          ),
        );
      }
    }
  }
  return diagnostics;
};

// ------------------------------------------------------------ runtime compat

const runtimeCompat: Rule = (model) => {
  const diagnostics: Diagnostic[] = [];
  if (model.infinite !== false) {
    diagnostics.push(error("runtime-infinite", "Infinite maps cannot be loaded by Phaser", "Turn off Infinite in Tiled's map properties."));
  }
  if (model.orientation !== "orthogonal") {
    diagnostics.push(error("runtime-orientation", `Orientation "${model.orientation}" is not supported by the runtime`, "Use an orthogonal map."));
  }
  for (const layer of model.layers) {
    if (isObjectLayer(layer)) {
      for (const object of layer.objects) {
        const spec = getObjectClassSpec(object.class);
        if (!spec) continue;
        for (const [name, propertySpec] of Object.entries(spec.properties)) {
          if (propertySpec.required && object.properties[name] === null) {
            diagnostics.push(error("runtime-null-property", `Property "${name}" on object ${object.id} is null`, "The runtime loader reads this without a null check; give it a value.", objectPath(layer, object)));
          }
        }
      }
    }
  }
  return diagnostics;
};

const RULES: Rule[] = [
  requiredLayers,
  layerKinds,
  layerOrder,
  dimensions,
  tilesetsResolve,
  objectsValid,
  spawns,
  spawnWalkable,
  reachability,
  zoneOverlap,
  runtimeCompat,
];

export function validateMap(model: MapModel, context: ValidationContext = {}): ValidationResult {
  const diagnostics = RULES.flatMap((rule) => rule(model, context));
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  const summary =
    errors === 0 && warnings === 0
      ? "Map is valid: no errors, no warnings."
      : `Map has ${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}.`;

  return { ok: errors === 0, diagnostics, summary };
}

// ------------------------------------------------------------------- helpers

/** Tiled packs flip flags into the top three bits of a gid. */
export function stripFlags(gid: number): number {
  return gid & 0x1fffffff;
}

function resolves(gid: number, model: MapModel, context: ValidationContext): boolean {
  for (const tileset of model.tilesets) {
    const count = context.tileCounts?.get(tileset.id) ?? tileset.tileCount;
    if (count <= 0) {
      // Unknown tile count: accept anything at or above firstgid rather than
      // inventing a failure the author cannot act on.
      if (gid >= tileset.firstgid) return true;
      continue;
    }
    if (gid >= tileset.firstgid && gid < tileset.firstgid + count) return true;
  }
  return false;
}

function maxKnownGid(model: MapModel, context: ValidationContext): number {
  let max = 0;
  for (const tileset of model.tilesets) {
    const count = context.tileCounts?.get(tileset.id) ?? tileset.tileCount;
    if (count > 0) max = Math.max(max, tileset.firstgid + count - 1);
  }
  return max;
}

function checkType(value: unknown, type: string): string | null {
  switch (type) {
    case "int":
      return typeof value === "number" && Number.isInteger(value) ? null : `is ${JSON.stringify(value)}, expected an integer`;
    case "float":
      return typeof value === "number" ? null : `is ${JSON.stringify(value)}, expected a number`;
    case "bool":
      return typeof value === "boolean" ? null : `is ${JSON.stringify(value)}, expected true or false`;
    default:
      return typeof value === "string" ? null : `is ${JSON.stringify(value)}, expected a string`;
  }
}

/** Tile objects anchor at their bottom-left corner; plain rectangles at top-left. */
function topOf(object: MapObject): number {
  return object.gid === undefined ? object.y : object.y - object.height;
}

function withinBounds(object: MapObject, model: MapModel): boolean {
  const top = topOf(object);
  return object.x >= 0 && top >= 0 && object.x + object.width <= model.width * model.tileWidth && top + object.height <= model.height * model.tileHeight;
}

function tileOf(object: MapObject, model: MapModel): { x: number; y: number } {
  return { x: Math.floor(object.x / model.tileWidth), y: Math.floor(topOf(object) / model.tileHeight) };
}

function overlaps(a: MapObject, b: MapObject): boolean {
  const aTop = topOf(a);
  const bTop = topOf(b);
  return a.x < b.x + b.width && b.x < a.x + a.width && aTop < bTop + b.height && bTop < aTop + a.height;
}

function objectPath(layer: ObjectLayer | TileLayer, object: MapObject): string {
  return `layers/${layer.name}/objects/${object.id}`;
}
