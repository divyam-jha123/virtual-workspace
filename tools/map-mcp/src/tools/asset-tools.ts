import { z } from "zod";
import { TILE_SIZE } from "../schema/index.js";
import { respond, respondWithMedia, type ToolModule } from "./registry.js";

const placement = z.enum(["floor", "wall", "ceiling", "overlay"]);

/** How many sprites one answer may carry, regardless of how many results match. */
const PREVIEW_LIMIT = 12;

/** `search_assets` / `get_asset` / `list_tilesets` — the filesystem catalog. */
export const registerAssetTools: ToolModule = (server, context) => {
  server.registerTool(
    "search_assets",
    {
      title: "Search assets",
      description:
        "Search the asset catalog for art to place. Results are ranked, synonym-expanded, and filtered to the project tile size " +
        "so anything returned can actually be placed on a map. Use the returned id with place_asset. " +
        "Pass showArt when a person is choosing between options — it returns the actual sprites, in result order, so they can " +
        "pick by eye instead of guessing from an id.",
      inputSchema: {
        query: z.string().optional().describe('Free text, e.g. "meeting table" or "plant".'),
        showArt: z
          .boolean()
          .optional()
          .describe("Return the sprite image for each result, in order, so a person can see the art before choosing."),
        category: z.string().optional().describe('Exact category, e.g. "furniture" or "decoration".'),
        style: z.string().optional().describe("Exact style tag, to keep a map visually consistent."),
        placement: placement.optional().describe("Where the asset is meant to sit."),
        tilesetId: z.string().optional().describe("Restrict to one tileset."),
        maxWidth: z.number().int().positive().optional().describe("Largest acceptable width, in tiles."),
        maxHeight: z.number().int().positive().optional().describe("Largest acceptable height, in tiles."),
        limit: z.number().int().positive().max(100).optional().describe("Maximum results (default 25)."),
      },
    },
    async ({ showArt, ...args }) =>
      respondWithMedia(async () => {
        const results = await context.assets.search(args);

        // Previews are capped independently of the result limit: the JSON list
        // stays complete and cheap, while the images stay a size a chat can show.
        const previewed = showArt ? results.slice(0, PREVIEW_LIMIT) : [];
        const previews = await Promise.all(previewed.map((record) => context.assets.previewOf(record)));
        const shown = previewed.filter((_, index) => previews[index] !== null).map((record) => record.id);

        return {
          data: {
            source: context.assets.sourceKind,
            tileSize: TILE_SIZE,
            count: results.length,
            assets: results,
            ...(showArt
              ? {
                  // Images arrive as a flat list, so name what each one is and in
                  // what order — otherwise they cannot be matched back to an id.
                  artShownFor: shown,
                  ...(shown.length < previewed.length
                    ? { artUnavailableFor: previewed.filter((r) => !shown.includes(r.id)).map((r) => r.id) }
                    : {}),
                  ...(results.length > previewed.length
                    ? { artNote: `Art shown for the first ${previewed.length} of ${results.length} results.` }
                    : {}),
                }
              : {}),
            ...(results.length === 0
              ? { hint: "Nothing matched. Try a broader query, drop the category/style filter, or call list_tilesets to see what art exists at all." }
              : {}),
          },
          images: previews
            .filter((preview): preview is NonNullable<typeof preview> => preview !== null)
            .map((preview) => ({ mimeType: preview.contentType, bytes: preview.bytes })),
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
        "Tilesets known to the project, scanned from content/tilesets/. `vendored: true` means the .tsj is a real file on disk — the " +
        "only kind a map may reference, because Tiled and the game load it straight from the filesystem.",
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
