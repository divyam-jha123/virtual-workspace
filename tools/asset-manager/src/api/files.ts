import { Router } from "express";
import type { AppContext } from "../context.js";
import { notFound } from "../lib/errors.js";
import { asyncHandler } from "./http.js";

/**
 * Serves a stored object by its opaque storage key. Keys are unguessable and
 * never reveal a filesystem path. Read-only; localhost CORS applies.
 */
export function createFilesRouter(ctx: AppContext): Router {
  const router = Router();
  router.get(
    "/:key(*)",
    asyncHandler(async (req, res) => {
      const key = req.params.key;
      const file = await ctx.prisma.assetFile.findUnique({ where: { storageKey: key } });
      if (!file) throw notFound("file not found");
      const bytes = await ctx.storage.getObject(key);
      res.setHeader("Content-Type", file.contentType || "application/octet-stream");
      res.setHeader("Content-Length", String(bytes.byteLength));
      res.setHeader("Cache-Control", "public, max-age=300");
      res.status(200).end(Buffer.from(bytes));
    }),
  );
  return router;
}
