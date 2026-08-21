import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { asyncHandler, parse } from "./http.js";
import { assertVendorTarget, vendor } from "../vendor/vendor.js";

export function createVendorRouter(ctx: AppContext): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parse(
        z.object({ tilesetKeys: z.array(z.string()).optional(), packId: z.string().optional() }),
        req.body ?? {},
      );
      assertVendorTarget(body.tilesetKeys);
      const result = await vendor(ctx, {
        ...(body.tilesetKeys ? { tilesetKeys: body.tilesetKeys } : {}),
        ...(body.packId ? { packId: body.packId } : {}),
      });
      res.json(result);
    }),
  );

  return router;
}
