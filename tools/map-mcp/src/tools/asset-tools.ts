import { z } from "zod";
import { TILE_SIZE } from "../schema/index.js";
import { respond, type ToolModule } from "./registry.js";

const placement = z.enum(["floor", "wall", "ceiling", "overlay"]);

/** `search_assets` / `get_asset` / `list_tilesets` — everything above the asset seam. */
export const registerAssetTools: ToolModule = (server, context) => {
  server.registerTool(
    "search_assets",
    {
      title: "Search assets",
      description:
        "Search the asset catalog for art to place. Results are ranked, synonym-expanded, and filtered to the project tile size " +
        "so anything returned can actually be placed on a map. Use the returned id with place_asset.",
      inputSchema: {
        query: z.string().optional().describe('Free text, e.g. "meeting table" or "plant".'),
        category: z.string().optional().describe('Exact category, e.g. "furniture" or "decoration".'),
        style: z.string().optional().describe("Exact style tag, to keep a map visually consistent."),
        placement: placement.optional().describe("Where the asset is meant to sit."),
        tilesetId: z.string().optional().describe("Restrict to one tileset."),
        maxWidth: z.number().int().positive().optional().describe("Largest acceptable width, in tiles."),
        maxHeight: z.number().int().positive().optional().describe("Largest acceptable height, in tiles."),
        limit: z.number().int().positive().max(100).optional().describe("Maximum results (default 25)."),
      },
    },
    async (args) =>
      respond(async () => {
        const results = await context.assets.search(args);
        return {
          source: context.assets.sourceKind,
          tileSize: TILE_SIZE,
          count: results.length,
          assets: results,
          ...(results.length === 0
            ? { hint: "Nothing matched. Try a broader query, drop the category/style filter, or call list_tilesets to see what art exists at all." }
            : {}),
        };
      }),
  );

  server.registerTool(
    "get_asset",
    {
      title: "Get asset",
      description: "Full record for one asset id: dimensions, tileset binding, collision footprint, and interaction metadata.",
      inputSchema: { assetId: z.string().describe("Exact asset id from search_assets.") },
    },
    async ({ assetId }) => respond(async () => ({ asset: await context.assets.get(assetId) })),
  );

  server.registerTool(
    "list_tilesets",
    {
      title: "List tilesets",
      description:
        "Tilesets known to the project. `vendored: true` means the .tsj is a real file in the workspace — the only kind a map may " +
        "reference, because Tiled and the game load it from disk with no API key.",
      inputSchema: {},
    },
    async () =>
      respond(async () => {
        const tilesets = await context.assets.listTilesets();
        return {
          source: context.assets.sourceKind,
          vendored: tilesets.filter((tileset) => tileset.vendored).length,
          tilesets,
        };
      }),
  );
};
