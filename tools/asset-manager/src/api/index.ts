import { Router } from "express";
import type { AppContext } from "../context.js";
import { corsMiddleware } from "../middleware/cors.js";
import { createAssetsRouter } from "./assets.js";
import { createFilesRouter } from "./files.js";
import { createImportRouter } from "./import.js";
import { createLicensesRouter } from "./licenses.js";
import { createPacksRouter } from "./packs.js";
import { createSelectionsRouter } from "./selections.js";
import { createTagsRouter } from "./tags.js";
import { createTilesetsRouter } from "./tilesets.js";
import { createVendorRouter } from "./vendor.js";

/** UI / admin surface. Localhost CORS; no API key (the Next UI is same-machine). */
export function createApiRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(corsMiddleware(ctx.config.corsOrigins));
  router.use("/packs", createPacksRouter(ctx));
  router.use("/assets", createAssetsRouter(ctx));
  router.use("/tags", createTagsRouter(ctx));
  router.use("/licenses", createLicensesRouter(ctx));
  router.use("/tilesets", createTilesetsRouter(ctx));
  router.use("/import", createImportRouter(ctx));
  router.use("/selections", createSelectionsRouter(ctx));
  router.use("/vendor", createVendorRouter(ctx));
  router.use("/files", createFilesRouter(ctx));
  return router;
}
