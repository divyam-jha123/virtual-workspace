import { MapMcpError } from "../errors.js";
import type { Layer, MapModel, MapObject, ObjectLayer, PropertyBag, PropertyValue, TileLayer } from "../model/map-model.js";
import { cloneMap, emptyTileData, findLayer, isObjectLayer, isTileLayer } from "../model/map-model.js";
import { LAYER_KINDS, LAYER_ORDER, LIMITS, TILE_SIZE, getObjectClassSpec, isLayerName } from "../schema/index.js";
import type { AssetService } from "./assets/asset-service.js";
import type { AssetRecord } from "./assets/types.js";
import { createEmptyMap, parseTmj, serializeTmj, tilesetIdFromSource } from "./tiled-adapter.js";
import { validateMap, type ValidationContext, type ValidationResult } from "./validator.js";
import type { WorkspaceService } from "./workspace.js";

export interface MapSummary {
  id: string;
  name?: string;
  width: number;
  height: number;
  tileSize: number;
  layers: Array<{ name: string; kind: string; type?: string; tiles?: number; objects?: number }>;
  tilesets: Array<{ id: string; firstgid: number; source: string }>;
  objects: Array<{ id: number; class: string; name: string; layer: string; tile: { x: number; y: number }; size: { width: number; height: number }; properties: PropertyBag }>;
  properties: PropertyBag;
  /** True when there are unsaved in-memory changes. */
  draft: boolean;
}

export interface MutationResult {
  mapId: string;
  message: string;
  validation: ValidationResult;
}

function requireMapId(id: string): string {
  if (!id.startsWith("maps/")) {
    throw new MapMcpError("INVALID_ARGUMENT", `Map id "${id}" must live under maps/`, {
      rule: "map-id",
      fix: 'Pass a workspace id such as "maps/hq.tmj".',
    });
  }
  if (!id.toLowerCase().endsWith(".tmj")) {
    throw new MapMcpError("INVALID_ARGUMENT", `Map id "${id}" must end in .tmj`, {
      rule: "map-id",
      fix: 'Tiled JSON maps use the .tmj extension, e.g. "maps/hq.tmj".',
    });
  }
  return id;
}

/**
 * Semantic operations over an in-memory `MapModel`.
 *
 * Every mutation goes to a draft held in memory; `save_map` is what reaches the
 * disk, and it refuses to write a map with `error` diagnostics. That means a
 * half-built map never lands in `maps/` where Tiled or Git would pick it up.
 */
export class MapService {
  private readonly drafts = new Map<string, MapModel>();

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly assets: AssetService,
  ) {}

  async list(): Promise<string[]> {
    return this.workspace.list("maps", { extensions: [".tmj"] });
  }

  /** Draft if one exists, otherwise the file on disk. */
  async load(mapId: string): Promise<MapModel> {
    const id = requireMapId(mapId);
    const draft = this.drafts.get(id);
    if (draft) return draft;
    const model = parseTmj(await this.workspace.readJson(id), id);
    this.drafts.set(id, model);
    return model;
  }

  hasDraft(mapId: string): boolean {
    return this.drafts.has(mapId);
  }

  discardDraft(mapId: string): void {
    this.drafts.delete(mapId);
  }

  async create(mapId: string, options: { width: number; height: number; name?: string; description?: string; overwrite?: boolean }): Promise<MutationResult> {
    const id = requireMapId(mapId);
    if (!options.overwrite && (await this.workspace.exists(id))) {
      throw new MapMcpError("ALREADY_EXISTS", `Map ${id} already exists`, {
        rule: "map-exists",
        path: id,
        fix: "Pick a different id, or pass overwrite=true to replace it.",
      });
    }
    if (options.width * options.height > LIMITS.maxWidth * LIMITS.maxHeight) {
      throw new MapMcpError("LIMIT_EXCEEDED", "Map is too large", { rule: "map-dimensions", fix: `Keep width and height within ${LIMITS.maxWidth}.` });
    }

    const model = createEmptyMap({
      width: options.width,
      height: options.height,
      tileSize: TILE_SIZE,
      ...(options.name ? { name: options.name } : {}),
      ...(options.description ? { description: options.description } : {}),
    });
    this.drafts.set(id, model);
    return this.result(id, `Created ${options.width}x${options.height} draft map with the standard layer stack. Nothing is on disk until save_map.`);
  }

  async addLayer(mapId: string, name: string, options: { kind?: "tilelayer" | "objectgroup" } = {}): Promise<MutationResult> {
    const model = await this.load(mapId);
    if (findLayer(model, name)) {
      throw new MapMcpError("ALREADY_EXISTS", `Layer "${name}" already exists`, { rule: "layer-exists", fix: "Use the existing layer, or pick another name." });
    }
    const kind = options.kind ?? (isLayerName(name) ? LAYER_KINDS[name] : "tilelayer");
    const base = { id: model.nextLayerId, name, visible: true, opacity: 1, properties: {} as PropertyBag };
    const layer: Layer =
      kind === "tilelayer"
        ? { ...base, kind: "tilelayer", width: model.width, height: model.height, data: emptyTileData(model.width, model.height) }
        : { ...base, kind: "objectgroup", objects: [] };

    model.nextLayerId += 1;
    model.layers.push(layer);
    // Keep the canonical bottom-to-top stack; unknown layers sort to the top.
    model.layers.sort((a, b) => layerRank(a.name) - layerRank(b.name));
    return this.result(mapId, `Added ${kind} "${name}".`);
  }

  async placeTiles(mapId: string, options: { layer: string; x: number; y: number; width: number; height: number; gid: number }): Promise<MutationResult> {
    const model = await this.load(mapId);
    const layer = this.tileLayer(model, options.layer);
    const { x, y, width, height, gid } = options;

    if (width < 1 || height < 1) {
      throw new MapMcpError("INVALID_ARGUMENT", "Tile region must be at least 1x1", { rule: "tile-region", fix: "Pass positive width and height, in tiles." });
    }
    if (x < 0 || y < 0 || x + width > model.width || y + height > model.height) {
      throw new MapMcpError("INVALID_ARGUMENT", `Region (${x},${y}) ${width}x${height} falls outside the ${model.width}x${model.height} map`, {
        rule: "tile-region",
        fix: `Keep the region within 0..${model.width - 1} x 0..${model.height - 1}.`,
      });
    }

    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) layer.data[row * model.width + column] = gid;
    }
    const verb = gid === 0 ? "Cleared" : `Filled with gid ${gid}`;
    return this.result(mapId, `${verb}: ${width * height} tile(s) on "${layer.name}" at (${x}, ${y}).`);
  }

  async addObject(
    mapId: string,
    options: { layer?: string; class: string; name?: string; x: number; y: number; width?: number; height?: number; properties?: PropertyBag },
  ): Promise<MutationResult & { objectId: number }> {
    const model = await this.load(mapId);
    const spec = getObjectClassSpec(options.class);
    const layerName = options.layer ?? spec?.layers[0];
    if (!layerName) {
      throw new MapMcpError("INVALID_ARGUMENT", `Unknown object class "${options.class}" and no layer given`, {
        rule: "object-class-unknown",
        fix: "Pass a known class, or name the object layer explicitly.",
      });
    }

    const layer = this.objectLayer(model, layerName);
    const widthTiles = options.width ?? 1;
    const heightTiles = options.height ?? 1;

    const object: MapObject = {
      id: model.nextObjectId,
      name: options.name ?? "",
      class: options.class,
      x: options.x * model.tileWidth,
      y: options.y * model.tileHeight,
      width: widthTiles * model.tileWidth,
      height: heightTiles * model.tileHeight,
      rotation: 0,
      visible: true,
      properties: { ...(options.properties ?? {}) },
    };
    model.nextObjectId += 1;
    layer.objects.push(object);

    const result = await this.result(mapId, `Added ${options.class} object ${object.id} on "${layer.name}" at tile (${options.x}, ${options.y}).`);
    return { ...result, objectId: object.id };
  }

  async placeAsset(
    mapId: string,
    options: { assetId: string; x: number; y: number; layer?: string; name?: string; properties?: PropertyBag },
  ): Promise<MutationResult & { objectId: number; asset: AssetRecord }> {
    const model = await this.load(mapId);
    const asset = await this.assets.get(options.assetId);

    if (asset.tileSize !== model.tileWidth) {
      throw new MapMcpError("INVALID_ARGUMENT", `Asset "${asset.id}" is drawn for ${asset.tileSize}px tiles but the map uses ${model.tileWidth}px`, {
        rule: "asset-tile-size",
        fix: `Search with tileSize=${model.tileWidth} to find art that fits this map.`,
      });
    }

    const binding = await this.ensureTileset(model, asset.tilesetId);
    const layerName = options.layer ?? (asset.category === "decoration" ? "Decorations" : "Furniture");
    const layer = this.objectLayer(model, layerName);

    const { width, height } = asset.dimensions;
    if (options.x < 0 || options.y < 0 || options.x + width > model.width || options.y + height > model.height) {
      throw new MapMcpError("INVALID_ARGUMENT", `A ${width}x${height} asset at (${options.x}, ${options.y}) does not fit the ${model.width}x${model.height} map`, {
        rule: "asset-out-of-bounds",
        fix: "Move it inside the map, or pick a smaller asset.",
      });
    }

    const properties: PropertyBag = { ...(options.properties ?? {}) };
    if (asset.interaction) {
      for (const [key, value] of Object.entries(asset.interaction)) {
        if (key === "class") continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") properties[key] ??= value;
      }
    }

    const object: MapObject = {
      id: model.nextObjectId,
      name: options.name ?? asset.name,
      class: asset.interaction?.class ?? "",
      x: options.x * model.tileWidth,
      // Tile objects anchor bottom-left, which is also how the game anchors sprites.
      y: (options.y + height) * model.tileHeight,
      width: width * model.tileWidth,
      height: height * model.tileHeight,
      rotation: 0,
      visible: true,
      gid: binding.firstgid + asset.tileId,
      properties,
    };
    model.nextObjectId += 1;
    layer.objects.push(object);

    if (asset.collision?.blocking) this.blockFootprint(model, asset, options.x, options.y);

    const result = await this.result(
      mapId,
      `Placed "${asset.name}" (${asset.id}) as object ${object.id} on "${layer.name}" at tile (${options.x}, ${options.y})${asset.collision?.blocking ? ", and marked its footprint on Collision" : ""}.`,
    );
    return { ...result, objectId: object.id, asset };
  }

  async moveObject(mapId: string, objectId: number, x: number, y: number): Promise<MutationResult> {
    const model = await this.load(mapId);
    const { object } = this.findObject(model, objectId);
    const isTileObject = object.gid !== undefined;
    object.x = x * model.tileWidth;
    object.y = isTileObject ? y * model.tileHeight + object.height : y * model.tileHeight;
    return this.result(mapId, `Moved object ${objectId} to tile (${x}, ${y}).`);
  }

  async removeObject(mapId: string, objectId: number): Promise<MutationResult> {
    const model = await this.load(mapId);
    const { layer, index } = this.findObject(model, objectId);
    layer.objects.splice(index, 1);
    return this.result(mapId, `Removed object ${objectId} from "${layer.name}".`);
  }

  async setProperty(mapId: string, name: string, value: PropertyValue, target: { objectId?: number; layer?: string }): Promise<MutationResult> {
    const model = await this.load(mapId);
    if (target.objectId !== undefined) {
      const { object } = this.findObject(model, target.objectId);
      object.properties[name] = value;
      return this.result(mapId, `Set ${name}=${JSON.stringify(value)} on object ${target.objectId}.`);
    }
    if (target.layer !== undefined) {
      const layer = findLayer(model, target.layer);
      if (!layer) throw this.noLayer(model, target.layer);
      layer.properties[name] = value;
      return this.result(mapId, `Set ${name}=${JSON.stringify(value)} on layer "${target.layer}".`);
    }
    model.properties[name] = value;
    return this.result(mapId, `Set map property ${name}=${JSON.stringify(value)}.`);
  }

  async addTileset(mapId: string, tilesetId: string): Promise<MutationResult> {
    const model = await this.load(mapId);
    const before = model.tilesets.length;
    const binding = await this.ensureTileset(model, tilesetId);
    const message =
      model.tilesets.length === before
        ? `Tileset "${tilesetId}" was already bound at firstgid ${binding.firstgid}.`
        : `Bound tileset "${tilesetId}" at firstgid ${binding.firstgid}.`;
    return this.result(mapId, message);
  }

  /** Flushes the draft to disk. Blocks on any `error` diagnostic. */
  async save(mapId: string): Promise<MutationResult & { path: string }> {
    const id = requireMapId(mapId);
    const model = await this.load(id);
    const validation = await this.validate(id);

    if (!validation.ok) {
      throw new MapMcpError("VALIDATION_FAILED", `Refusing to save ${id}: ${validation.summary}`, {
        diagnostics: [
          ...validation.diagnostics.filter((d) => d.severity === "error"),
          {
            severity: "info",
            rule: "save-blocked",
            message: "Nothing was written; the draft is still in memory.",
            fix: "Fix the errors above and call save_map again. Warnings do not block a save.",
          },
        ],
      });
    }

    const tiles = model.layers.reduce((total, layer) => (isTileLayer(layer) ? total + layer.data.length : total), 0);
    await this.workspace.writeJson(id, serializeTmj(model));
    return { mapId: id, path: id, message: `Saved ${id} (${model.width}x${model.height}, ${tiles} tiles). Open it in Tiled to review.`, validation };
  }

  async validate(mapId: string): Promise<ValidationResult> {
    const model = await this.load(mapId);
    return validateMap(model, await this.validationContext());
  }

  async summarize(mapId: string): Promise<MapSummary> {
    const id = requireMapId(mapId);
    const model = await this.load(id);

    return {
      id,
      ...(typeof model.properties.name === "string" ? { name: model.properties.name } : {}),
      width: model.width,
      height: model.height,
      tileSize: model.tileWidth,
      layers: model.layers.map((layer) =>
        isTileLayer(layer)
          ? { name: layer.name, kind: layer.kind, tiles: layer.data.filter((gid) => gid !== 0).length }
          : { name: layer.name, kind: layer.kind, objects: layer.objects.length },
      ),
      tilesets: model.tilesets.map((tileset) => ({ id: tileset.id, firstgid: tileset.firstgid, source: tileset.source })),
      objects: model.layers.flatMap((layer) =>
        isObjectLayer(layer)
          ? layer.objects.map((object) => ({
              id: object.id,
              class: object.class,
              name: object.name,
              layer: layer.name,
              tile: {
                x: Math.floor(object.x / model.tileWidth),
                y: Math.floor((object.gid === undefined ? object.y : object.y - object.height) / model.tileHeight),
              },
              size: { width: Math.round(object.width / model.tileWidth), height: Math.round(object.height / model.tileHeight) },
              properties: object.properties,
            }))
          : [],
      ),
      properties: model.properties,
      draft: this.drafts.has(id),
    };
  }

  /** Snapshot of the current draft, for diffing later. */
  snapshot(mapId: string): MapModel | undefined {
    const model = this.drafts.get(mapId);
    return model ? cloneMap(model) : undefined;
  }

  // ------------------------------------------------------------- internals

  private async validationContext(): Promise<ValidationContext> {
    const vendored = new Set<string>();
    const tileCounts = new Map<string, number>();
    const tileSizes = new Map<string, number>();
    const missingAtlasImages = new Map<string, string[]>();

    const present = new Set(await this.workspace.list("tilesets", { extensions: [".png"] }));

    for (const id of await this.workspace.list("tilesets", { extensions: [".tsj"] })) {
      const name = tilesetIdFromSource(id);
      vendored.add(name);
      try {
        const tsj = await this.workspace.readJson<Record<string, unknown>>(id);
        if (typeof tsj.tilecount === "number") tileCounts.set(name, tsj.tilecount);
        if (typeof tsj.tilewidth === "number") tileSizes.set(name, tsj.tilewidth);

        const missing = imageReferences(tsj).filter((image) => !present.has(`tilesets/${basename(image)}`));
        if (missing.length > 0) missingAtlasImages.set(name, missing);
      } catch {
        // A corrupt .tsj still counts as present; the gid rules degrade gracefully.
      }
    }
    return { vendoredTilesets: vendored, tileCounts, tileSizes, missingAtlasImages };
  }

  private async result(mapId: string, message: string): Promise<MutationResult> {
    return { mapId, message, validation: await this.validate(mapId) };
  }

  /** Binds a tileset if it is not bound yet, assigning the next free firstgid. */
  private async ensureTileset(model: MapModel, tilesetId: string): Promise<MapModel["tilesets"][number]> {
    const existing = model.tilesets.find((tileset) => tileset.id === tilesetId);
    if (existing) return existing;

    const workspaceId = `tilesets/${tilesetId}.tsj`;
    if (!(await this.workspace.exists(workspaceId))) {
      // A map may only reference tilesets that exist as real files on disk, or
      // Tiled cannot open it. The filesystem is the source of truth — nothing is
      // fetched.
      throw new MapMcpError("ASSET_NOT_FOUND", `Tileset "${tilesetId}" is not present in the workspace`, {
        rule: "tileset-not-vendored",
        path: workspaceId,
        fix: "Add the .tsj and its atlas image (.png) to content/tilesets/. A map may only reference tilesets that exist as real files, or Tiled cannot open it.",
      });
    }

    const tsj = await this.workspace.readJson<Record<string, unknown>>(workspaceId);
    const tileCount = typeof tsj.tilecount === "number" ? tsj.tilecount : 0;

    // A .tmj stores only {firstgid, source} per tileset, so a binding parsed from
    // disk carries no tile count. Resolving each one from its .tsj is what keeps
    // gid ranges from overlapping: guessing 1 tile per set puts the second
    // tileset's range on top of the first, and every tile then resolves to the
    // wrong art.
    let firstgid = 1;
    for (const binding of model.tilesets) {
      const count = binding.tileCount > 0 ? binding.tileCount : await this.tileCountOf(binding.id);
      binding.tileCount = count;
      firstgid = Math.max(firstgid, binding.firstgid + Math.max(count, 1));
    }

    const binding = {
      firstgid,
      // Maps live in maps/, tilesets in tilesets/ — one level up and across.
      source: `../tilesets/${tilesetId}.tsj`,
      id: tilesetId,
      tileCount,
      ...(typeof tsj.tilewidth === "number" ? { tileWidth: tsj.tilewidth } : {}),
      ...(typeof tsj.tileheight === "number" ? { tileHeight: tsj.tileheight } : {}),
    };
    model.tilesets.push(binding);
    return binding;
  }

  /** Tile count from a vendored `.tsj`, or 0 when it is missing or unreadable. */
  private async tileCountOf(tilesetId: string): Promise<number> {
    const workspaceId = `tilesets/${tilesetId}.tsj`;
    try {
      const tsj = await this.workspace.readJson<Record<string, unknown>>(workspaceId);
      return typeof tsj.tilecount === "number" ? tsj.tilecount : 0;
    } catch {
      return 0;
    }
  }

  /** Marks the Collision layer under an asset whose footprint blocks movement. */
  private blockFootprint(model: MapModel, asset: AssetRecord, x: number, y: number): void {
    const collision = findLayer(model, "Collision");
    if (!collision || !isTileLayer(collision)) return;

    const box = asset.collision?.box ?? { x: 0, y: 0, width: asset.dimensions.width, height: asset.dimensions.height };
    for (let row = y + box.y; row < y + box.y + box.height; row += 1) {
      for (let column = x + box.x; column < x + box.x + box.width; column += 1) {
        if (row < 0 || column < 0 || row >= model.height || column >= model.width) continue;
        collision.data[row * model.width + column] = 1;
      }
    }
  }

  private tileLayer(model: MapModel, name: string): TileLayer {
    const layer = findLayer(model, name);
    if (!layer) throw this.noLayer(model, name);
    if (!isTileLayer(layer)) {
      throw new MapMcpError("INVALID_ARGUMENT", `Layer "${name}" is an object layer, not a tile layer`, {
        rule: "layer-kind",
        fix: "Use add_object for object layers; place_tiles only works on tile layers.",
      });
    }
    return layer;
  }

  private objectLayer(model: MapModel, name: string): ObjectLayer {
    const layer = findLayer(model, name);
    if (!layer) throw this.noLayer(model, name);
    if (!isObjectLayer(layer)) {
      throw new MapMcpError("INVALID_ARGUMENT", `Layer "${name}" is a tile layer, not an object layer`, {
        rule: "layer-kind",
        fix: "Use place_tiles for tile layers; add_object only works on object layers.",
      });
    }
    return layer;
  }

  private findObject(model: MapModel, objectId: number): { layer: ObjectLayer; object: MapObject; index: number } {
    for (const layer of model.layers) {
      if (!isObjectLayer(layer)) continue;
      const index = layer.objects.findIndex((object) => object.id === objectId);
      if (index >= 0) return { layer, object: layer.objects[index]!, index };
    }
    throw new MapMcpError("NOT_FOUND", `No object with id ${objectId}`, {
      rule: "object-missing",
      fix: "Call read_map to see the current object ids.",
    });
  }

  private noLayer(model: MapModel, name: string): MapMcpError {
    return new MapMcpError("NOT_FOUND", `Map has no layer "${name}"`, {
      rule: "layer-missing",
      fix: `Existing layers: ${model.layers.map((layer) => layer.name).join(", ") || "(none)"}. Add one with add_layer.`,
    });
  }
}

/** Basename of a `.tsj` image reference, which may be written as a relative path. */
function basename(reference: string): string {
  return reference.split("\\").join("/").split("/").pop() ?? reference;
}

/** Collects `image` fields from a tileset, both the atlas form and per-tile images. */
function imageReferences(tsj: Record<string, unknown>): string[] {
  const found = new Set<string>();
  if (typeof tsj.image === "string") found.add(tsj.image);
  const tiles = tsj.tiles;
  if (Array.isArray(tiles)) {
    for (const tile of tiles) {
      if (tile && typeof tile === "object" && typeof (tile as { image?: unknown }).image === "string") {
        found.add((tile as { image: string }).image);
      }
    }
  }
  return [...found];
}

function layerRank(name: string): number {
  const index = LAYER_ORDER.indexOf(name as (typeof LAYER_ORDER)[number]);
  return index === -1 ? LAYER_ORDER.length : index;
}
