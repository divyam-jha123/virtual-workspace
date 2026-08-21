import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { asyncHandler, parse } from "./http.js";
import { chooseSelection, readSelection, selectionCandidates, toSelectionStatus } from "../selections/selections.js";
import { AssetImageResolver } from "../lib/asset-image.js";

/**
 * Browser side of a selection. No API key — same as the rest of /api — so the
 * token in the URL is what authorises the read and the answer.
 *
 * Candidates come back with image urls rather than raw storage keys, so the pick
 * page can render sprites without ever learning where bytes live.
 */
export function createSelectionsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get(
    "/:token",
    asyncHandler(async (req, res) => {
      const selection = await readSelection(ctx, req.params.token);
      const rows = await selectionCandidates(ctx, selection);
      const images = new AssetImageResolver(ctx);
      res.json({
        ...toSelectionStatus(selection),
        candidates: await Promise.all(
          rows.map(async (asset) => ({
            slug: asset.slug,
            name: asset.name,
            category: asset.category,
            subcategory: asset.subcategory,
            placement: asset.placement,
            widthTiles: asset.widthTiles,
            heightTiles: asset.heightTiles,
            tilesetKey: asset.tileset?.key ?? null,
            tags: asset.tags.map((tag) => tag.label),
            imageUrl: await images.urlFor(asset),
          })),
        ),
      });
    }),
  );

  router.post(
    "/:token/choose",
    asyncHandler(async (req, res) => {
      const { assetId } = parse(z.object({ assetId: z.string().min(1) }), req.body ?? {});
      res.json(toSelectionStatus(await chooseSelection(ctx, req.params.token, assetId)));
    }),
  );

  return router;
}
