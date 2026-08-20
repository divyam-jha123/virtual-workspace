import { z } from "zod";
import { describeConventions, LAYER_ORDER, TILE_SIZE } from "../schema/index.js";
import { respond, type ToolModule } from "./registry.js";

/** `get_project_info` — the orientation call a session should make first. */
export const registerProjectTools: ToolModule = (server, context) => {
  server.registerTool(
    "get_project_info",
    {
      title: "Get project info",
      description:
        "Project conventions (tile size, layer stack, object classes), the list of maps in the workspace, " +
        "and the current asset-source status including how many tilesets are usable offline. Call this first.",
      inputSchema: { includeConventions: z.boolean().optional().describe("Include the full object-class schema (default true).") },
    },
    async ({ includeConventions = true }) =>
      respond(async () => {
        const [maps, tilesets, status] = await Promise.all([
          context.maps.list(),
          context.assets.listTilesets(),
          context.assets.status(),
        ]);

        return {
          workspace: {
            root: "/workspace",
            directories: { maps: "maps/", tilesets: "tilesets/", assets: "assets/", runtime: "runtime/", schemas: "schemas/" },
            note: "All paths are workspace-relative ids. Absolute paths, '..' and escaping symlinks are rejected.",
          },
          maps,
          tileSize: TILE_SIZE,
          layerOrder: LAYER_ORDER,
          assetSource: status,
          tilesets: tilesets.map((tileset) => ({ id: tileset.id, vendored: tileset.vendored, ...(tileset.version ? { version: tileset.version } : {}) })),
          ...(includeConventions ? { conventions: describeConventions() } : {}),
        };
      }),
  );

  server.registerResource(
    "project-config",
    "project://config",
    { title: "Project config", description: "Tile size, workspace layout, and the configured asset source.", mimeType: "application/json" },
    async (uri) => {
      const status = await context.assets.status();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                tileSize: TILE_SIZE,
                workspaceRoot: "/workspace",
                directories: ["maps", "tilesets", "assets", "runtime", "schemas", ".map-mcp"],
                assetSource: status,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "project-conventions",
    "project://conventions",
    { title: "Map conventions", description: "Layer stack, object classes, required properties, and authoring limits.", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(describeConventions(), null, 2) }],
    }),
  );

  server.registerResource(
    "map-schema",
    "map://schema",
    { title: "Map schema", description: "The map contract as JSON Schema-shaped data: layers and object-class properties.", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(describeConventions(), null, 2) }],
    }),
  );

  server.registerResource(
    "assets-tilesets",
    "assets://tilesets",
    { title: "Vendored tilesets", description: "Tilesets available in the workspace, and which are usable offline.", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await context.assets.listTilesets(), null, 2) }],
    }),
  );
};
