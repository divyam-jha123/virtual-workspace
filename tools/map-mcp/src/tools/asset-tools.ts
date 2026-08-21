import { z } from "zod";
import { MapMcpError } from "../errors.js";
import { TILE_SIZE } from "../schema/index.js";
import { respond, respondWithMedia, type ToolModule } from "./registry.js";

const placement = z.enum(["floor", "wall", "ceiling", "overlay"]);

/** How many sprites one answer may carry, regardless of how many results match. */
const PREVIEW_LIMIT = 12;

/** `search_assets` / `get_asset` / `list_tilesets` — everything above the asset seam. */
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
    "pick_asset",
    {
      title: "Ask a person to pick art",
      description:
        "Put a shortlist of assets in front of a person as a grid of sprites in their browser, and wait for them to click one. " +
        "Use this when the choice is a matter of taste rather than fact — which chair, which plant — and you would otherwise be " +
        "guessing on their behalf. Returns the chosen asset id, ready for place_asset. " +
        "If the wait runs out the link stays live: call again with the same token to keep waiting.",
      inputSchema: {
        prompt: z.string().describe('What they are choosing, e.g. "chair for the meeting room". Shown above the grid.'),
        assetIds: z
          .array(z.string())
          .min(1)
          .max(50)
          .optional()
          .describe("Shortlist, in preference order. Required unless resuming with a token."),
        token: z.string().optional().describe("Resume waiting on a selection that timed out. Omit to start a new one."),
        waitSeconds: z
          .number()
          .int()
          .min(0)
          .max(600)
          .optional()
          .describe("How long to wait before returning (default 120). Returning early does not cancel the link."),
        expiresInSeconds: z.number().int().min(30).max(3600).optional().describe("How long the link stays usable (default 900)."),
      },
    },
    async ({ prompt, assetIds, token, waitSeconds, expiresInSeconds }) =>
      respond(async () => {
        if (!token && !assetIds?.length) {
          throw new MapMcpError("INVALID_ARGUMENT", "pick_asset needs assetIds when starting a new selection", {
            rule: "selection-no-candidates",
            fix: "Call search_assets first and pass the ids you want to offer.",
          });
        }

        const session = token
          ? await context.assets.readSelection(token)
          : await context.assets.createSelection(prompt, assetIds ?? [], expiresInSeconds);

        const { selection, timedOut } = await context.assets.awaitSelection(session.token, {
          waitMs: (waitSeconds ?? 120) * 1000,
        });

        if (selection.status === "chosen" && selection.chosenId) {
          return {
            status: "chosen",
            assetId: selection.chosenId,
            asset: await context.assets.get(selection.chosenId),
            hint: "Place it with place_asset; the tileset is fetched automatically if it is not on disk.",
          };
        }

        if (timedOut) {
          return {
            status: "waiting",
            token: selection.token,
            url: selection.url,
            expiresAt: selection.expiresAt,
            hint:
              `Nobody has answered yet. The link is still open — share ${selection.url ?? "the pick link"} and call pick_asset ` +
              "again with this token to keep waiting, or choose an id yourself and skip the picker.",
          };
        }

        return {
          status: selection.status,
          token: selection.token,
          ...(selection.url ? { url: selection.url } : {}),
          hint:
            selection.status === "expired"
              ? "The link timed out. Start a new selection to ask again."
              : "The selection was cancelled. Start a new one, or place an asset by id.",
        };
      }),
  );

  server.registerTool(
    "sync_tilesets",
    {
      title: "Sync tilesets",
      description:
        "Pull tilesets from the asset source onto disk — the .tsj plus every image it references — so Tiled and the game can open " +
        "them with no network and no API key. With no ids, fetches everything the source knows about that is not already vendored. " +
        "place_asset does this on its own when art is missing; call it directly to pre-fetch, or with force to refresh stale art.",
      inputSchema: {
        tilesetIds: z.array(z.string()).optional().describe("Tileset ids to fetch. Omit to fetch every tileset that is not vendored yet."),
        force: z.boolean().optional().describe("Re-fetch even when the .tsj is already on disk, overwriting it."),
      },
    },
    async ({ tilesetIds, force }) =>
      respond(async () => {
        const result = await context.assets.syncTilesets(tilesetIds, { force: force ?? false });
        const blank = result.synced.filter((entry) => entry.missingImages.length > 0);
        return {
          source: context.assets.sourceKind,
          ...result,
          ...(blank.length > 0
            ? {
                warning:
                  `${blank.length} tileset(s) reference images the source did not supply; those tiles render blank in Tiled. ` +
                  "Check the tileset in the asset library.",
              }
            : {}),
          ...(result.synced.length === 0 && result.failed.length === 0
            ? { hint: "Nothing to fetch — every tileset the source knows about is already on disk. Pass force to re-fetch anyway." }
            : {}),
        };
      }),
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
