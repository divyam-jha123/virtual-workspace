import { z } from "zod";
import { LAYER_ORDER, OBJECT_CLASS_NAMES } from "../schema/index.js";
import { respond, type ToolModule } from "./registry.js";

const mapId = z.string().describe('Workspace map id, e.g. "maps/hq.tmj".');
const propertyValue = z.union([z.string(), z.number(), z.boolean()]);
const properties = z.record(propertyValue).optional().describe("Custom properties, as defined by the object's class.");

/** Read, create, mutate, validate, and save maps. */
export const registerMapTools: ToolModule = (server, context) => {
  server.registerTool(
    "read_map",
    {
      title: "Read map",
      description: "A semantic view of a map: layers with tile/object counts, every object with its class, tile position and properties, and bound tilesets.",
      inputSchema: { mapId },
    },
    async ({ mapId: id }) =>
      respond(async () => ({ map: await context.maps.summarize(id), validation: await context.maps.validate(id) })),
  );

  server.registerTool(
    "create_map",
    {
      title: "Create map",
      description: `Start a new draft map with the standard layer stack (${LAYER_ORDER.join(", ")}). The draft lives in memory until save_map.`,
      inputSchema: {
        mapId,
        width: z.number().int().positive().describe("Width in tiles."),
        height: z.number().int().positive().describe("Height in tiles."),
        name: z.string().optional().describe("Display name stored as a map property."),
        description: z.string().optional(),
        overwrite: z.boolean().optional().describe("Replace an existing map file (default false)."),
      },
    },
    async ({ mapId: id, ...options }) => respond(async () => ({ ...(await context.maps.create(id, options)) })),
  );

  server.registerTool(
    "add_layer",
    {
      title: "Add layer",
      description: "Add a layer and slot it into the canonical bottom-to-top order. Known schema layers get their correct type automatically.",
      inputSchema: {
        mapId,
        name: z.string().describe(`Layer name. Schema layers: ${LAYER_ORDER.join(", ")}.`),
        kind: z.enum(["tilelayer", "objectgroup"]).optional().describe("Only needed for a layer outside the schema."),
      },
    },
    async ({ mapId: id, name, kind }) => respond(async () => ({ ...(await context.maps.addLayer(id, name, kind ? { kind } : {})) })),
  );

  server.registerTool(
    "place_tiles",
    {
      title: "Place tiles",
      description: "Fill a rectangular region of a tile layer with one tile id. Pass gid 0 to clear. Coordinates are in tiles.",
      inputSchema: {
        mapId,
        layer: z.string().describe("Target tile layer name."),
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        gid: z.number().int().min(0).describe("Global tile id: the tileset's firstgid plus the tile index. 0 clears."),
      },
    },
    async ({ mapId: id, ...options }) => respond(async () => ({ ...(await context.maps.placeTiles(id, options)) })),
  );

  server.registerTool(
    "place_asset",
    {
      title: "Place asset",
      description:
        "Place a catalog asset at a tile position. Binds the asset's tileset if needed, anchors the object the way the game does, " +
        "carries over interaction metadata, and marks the Collision layer when the asset blocks movement.",
      inputSchema: {
        mapId,
        assetId: z.string().describe("Asset id from search_assets."),
        x: z.number().int().min(0).describe("Tile x of the asset's top-left corner."),
        y: z.number().int().min(0).describe("Tile y of the asset's top-left corner."),
        layer: z.string().optional().describe("Override the target object layer (default Furniture, or Decorations for decor)."),
        name: z.string().optional(),
        properties,
      },
    },
    async ({ mapId: id, ...options }) =>
      respond(async () => {
        const { asset, ...result } = await context.maps.placeAsset(id, options);
        return { ...result, asset: { id: asset.id, name: asset.name, dimensions: asset.dimensions, tilesetId: asset.tilesetId } };
      }),
  );

  server.registerTool(
    "add_object",
    {
      title: "Add object",
      description: `Add a typed object — spawn points, doors, seats, meeting rooms, interaction zones. Classes: ${OBJECT_CLASS_NAMES.join(", ")}.`,
      inputSchema: {
        mapId,
        class: z.string().describe(`Object class. One of: ${OBJECT_CLASS_NAMES.join(", ")}.`),
        x: z.number().int().min(0).describe("Tile x."),
        y: z.number().int().min(0).describe("Tile y."),
        width: z.number().int().positive().optional().describe("Width in tiles (default 1)."),
        height: z.number().int().positive().optional().describe("Height in tiles (default 1)."),
        name: z.string().optional(),
        layer: z.string().optional().describe("Defaults to the layer the class belongs on."),
        properties,
      },
    },
    async ({ mapId: id, class: objectClass, ...rest }) =>
      respond(async () => ({ ...(await context.maps.addObject(id, { class: objectClass, ...rest })) })),
  );

  server.registerTool(
    "move_object",
    {
      title: "Move object",
      description: "Move an object to a new tile position, keeping its size, class and properties.",
      inputSchema: { mapId, objectId: z.number().int().positive(), x: z.number().int().min(0), y: z.number().int().min(0) },
    },
    async ({ mapId: id, objectId, x, y }) => respond(async () => ({ ...(await context.maps.moveObject(id, objectId, x, y)) })),
  );

  server.registerTool(
    "remove_object",
    {
      title: "Remove object",
      description: "Delete an object from the map.",
      inputSchema: { mapId, objectId: z.number().int().positive() },
    },
    async ({ mapId: id, objectId }) => respond(async () => ({ ...(await context.maps.removeObject(id, objectId)) })),
  );

  server.registerTool(
    "set_property",
    {
      title: "Set property",
      description: "Set a custom property on an object, a layer, or the map itself. Exactly one target; omit both for the map.",
      inputSchema: {
        mapId,
        name: z.string(),
        value: propertyValue,
        objectId: z.number().int().positive().optional(),
        layer: z.string().optional(),
      },
    },
    async ({ mapId: id, name, value, objectId, layer }) =>
      respond(async () => ({
        ...(await context.maps.setProperty(id, name, value, {
          ...(objectId === undefined ? {} : { objectId }),
          ...(layer === undefined ? {} : { layer }),
        })),
      })),
  );

  server.registerTool(
    "add_tileset",
    {
      title: "Add tileset",
      description: "Bind a vendored tileset to the map as an external reference and assign it a firstgid.",
      inputSchema: { mapId, tilesetId: z.string().describe("Tileset id — the .tsj basename in tilesets/.") },
    },
    async ({ mapId: id, tilesetId }) => respond(async () => ({ ...(await context.maps.addTileset(id, tilesetId)) })),
  );

  server.registerTool(
    "validate_map",
    {
      title: "Validate map",
      description: "Run every structural, tileset, object, gameplay and runtime-compatibility rule. Errors block save_map; warnings do not.",
      inputSchema: { mapId },
    },
    async ({ mapId: id }) => respond(async () => ({ validation: await context.maps.validate(id) })),
  );

  server.registerTool(
    "save_map",
    {
      title: "Save map",
      description: "Write the draft to its .tmj file. Refuses to write while any error-severity diagnostic stands.",
      inputSchema: { mapId },
    },
    async ({ mapId: id }) => respond(async () => ({ ...(await context.maps.save(id)) })),
  );
};
