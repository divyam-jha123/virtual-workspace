import express, { type Express } from "express";
import type { AppContext } from "./context.js";
import { requireApiKey } from "./middleware/auth.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { createApiRouter } from "./api/index.js";
import { createV1Router } from "./v1/v1-router.js";

/** Builds the Express app. No listen() here, so tests can use supertest. */
export function createServer(ctx: AppContext): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(corsMiddleware(ctx.config.corsOrigins));
  app.use(express.json({ limit: "4mb" }));

  app.get("/health", async (_req, res) => {
    let db = false;
    try {
      await ctx.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    res.status(db ? 200 : 503).json({ status: db ? "ok" : "degraded", db, service: "asset-manager" });
  });

  // The native MCP contract. Guarded by the single static API key.
  app.use("/v1", requireApiKey(ctx.config.apiKey), createV1Router(ctx));

  // UI / admin surface. Same-origin from the Next UI; localhost CORS otherwise.
  app.use("/api", createApiRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
