import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import type { AppContext } from "../context.js";
import { notFound } from "../lib/errors.js";
import { isPng } from "../lib/png.js";
import { sanitizePngName } from "../lib/filenames.js";
import { normalizeTsjForVendor, type TilesetJson } from "../tileset/tsj.js";
import { toAssetRecord, toTilesetRef, type AssetWithRelations } from "./dto.js";
import { cancelSelection, createSelection, readSelection, toSelectionStatus } from "../selections/selections.js";

const ASSET_INCLUDE = { tags: true, tileset: true, license: true } as const;

function etagOf(body: string): string {
  return `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
}

/** Send JSON with an ETag, honouring If-None-Match (the MCP revalidates). */
function sendJson(req: Request, res: Response, payload: unknown): void {
  const body = JSON.stringify(payload);
  const etag = etagOf(body);
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(body);
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) =>
    fn(req, res).catch(next);

export function createV1Router(ctx: AppContext): Router {
  const router = Router();
  const { prisma } = ctx;

  // --- GET /v1/assets -------------------------------------------------------
  router.get(
    "/assets",
    wrap(async (req, res) => {
      const q = str(req.query.q);
      const category = str(req.query.category);
      const style = str(req.query.style);
      const placement = str(req.query.placement);
      const tileset = str(req.query.tileset);
      const tileSize = int(req.query.tileSize);
      const limit = Math.min(int(req.query.limit) ?? 25, 200);

      // Base filter: placeable only, and never from a pack flagged non-16.
      const where: Prisma.AssetWhereInput = {
        tilesetId: { not: null },
        tileId: { not: null },
        pack: { OR: [{ tileSize: null }, { tileSize: 16 }] },
      };
      if (category) where.category = { equals: category, mode: "insensitive" };
      if (style) where.style = { equals: style, mode: "insensitive" };
      if (placement) where.placement = placement as Prisma.AssetWhereInput["placement"];
      if (tileSize !== undefined) where.tileSize = tileSize;
      if (tileset) where.tileset = { key: tileset };

      const terms = expandTerms(q);
      if (terms.length > 0) {
        where.OR = terms.flatMap((t) => [
          { name: { contains: t, mode: "insensitive" } },
          { slug: { contains: t, mode: "insensitive" } },
          { category: { contains: t, mode: "insensitive" } },
          { subcategory: { contains: t, mode: "insensitive" } },
          { style: { contains: t, mode: "insensitive" } },
          { tags: { some: { slug: { contains: t } } } },
        ]);
      }

      const rows = (await prisma.asset.findMany({
        where,
        include: ASSET_INCLUDE,
        take: limit,
        orderBy: { slug: "asc" },
      })) as AssetWithRelations[];

      const items = rows.map(toAssetRecord).filter((r): r is NonNullable<typeof r> => r !== null);
      sendJson(req, res, { items, total: items.length });
    }),
  );

  // --- GET /v1/assets/:id ---------------------------------------------------
  router.get(
    "/assets/:id",
    wrap(async (req, res) => {
      const row = (await prisma.asset.findUnique({
        where: { slug: req.params.id },
        include: ASSET_INCLUDE,
      })) as AssetWithRelations | null;
      const record = row ? toAssetRecord(row) : null;
      if (!record) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      sendJson(req, res, { asset: record });
    }),
  );

  // --- Selections: the MCP asks, a person answers in the browser ------------
  //
  // Deliberately not ETag'd: a poll must see the answer the moment it lands, and
  // a 304 on a status endpoint is exactly the wrong behaviour.
  router.post(
    "/selections",
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as { prompt?: unknown; candidateIds?: unknown; ttlSeconds?: unknown };
      const selection = await createSelection(ctx, {
        prompt: typeof body.prompt === "string" ? body.prompt : "",
        candidateIds: Array.isArray(body.candidateIds) ? (body.candidateIds as string[]) : [],
        ...(typeof body.ttlSeconds === "number" ? { ttlSeconds: body.ttlSeconds } : {}),
      });
      res.status(201).json(toSelectionStatus(selection, ctx.config.publicUrl));
    }),
  );

  router.get(
    "/selections/:token",
    wrap(async (req, res) => {
      const selection = await readSelection(ctx, req.params.token);
      res.json(toSelectionStatus(selection, ctx.config.publicUrl));
    }),
  );

  router.post(
    "/selections/:token/cancel",
    wrap(async (req, res) => {
      res.json(toSelectionStatus(await cancelSelection(ctx, req.params.token), ctx.config.publicUrl));
    }),
  );

  // --- GET /v1/tilesets -----------------------------------------------------
  router.get(
    "/tilesets",
    wrap(async (req, res) => {
      // Only placeable tilesets (16px grid) are visible to the MCP.
      const rows = await prisma.tileset.findMany({
        where: { tileWidth: 16, tileHeight: 16 },
        orderBy: { key: "asc" },
      });
      sendJson(req, res, { items: rows.map(toTilesetRef) });
    }),
  );

  // --- GET /v1/tilesets/:file  (either <key>.tsj or an image basename) -------
  router.get(
    "/tilesets/:file",
    wrap(async (req, res) => {
      const file = req.params.file;
      if (file.toLowerCase().endsWith(".tsj")) {
        const key = file.slice(0, -".tsj".length);
        const tsj = await loadVendorTsj(ctx, key);
        if (!tsj) {
          res.status(404).json({ error: "not_found" });
          return;
        }
        sendJson(req, res, tsj);
        return;
      }
      notFoundOrImage();
      function notFoundOrImage() {
        res.status(404).json({ error: "not_found", message: "Use /v1/tilesets/{id}/{image}.png for atlas images." });
      }
    }),
  );

  // --- GET /v1/tilesets/:key/:image.png  (atlas or per-tile image) ----------
  router.get(
    "/tilesets/:key/:image",
    wrap(async (req, res) => {
      const key = req.params.key;
      const image = sanitizePngName(req.params.image);
      const tileset = await prisma.tileset.findUnique({ where: { key }, include: { files: true } });
      if (!tileset) throw notFound(`No tileset "${key}"`);
      const fileRow = tileset.files.find(
        (f) => (f.role === "atlas" || f.role === "tile_image") && f.filename === image,
      );
      if (!fileRow) throw notFound(`Tileset "${key}" has no image "${image}"`);
      const bytes = await ctx.storage.getObject(fileRow.storageKey);
      if (!isPng(bytes)) throw notFound("stored image is not a PNG");
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", String(bytes.byteLength));
      res.status(200).end(Buffer.from(bytes));
    }),
  );

  return router;
}

/** Build the vendor-ready .tsj for a tileset key from its stored canonical .tsj. */
async function loadVendorTsj(ctx: AppContext, key: string): Promise<TilesetJson | null> {
  const tileset = await ctx.prisma.tileset.findUnique({ where: { key }, include: { files: true } });
  if (!tileset) return null;
  const tsjFile = tileset.files.find((f) => f.role === "tsj");
  if (!tsjFile) return null;
  const bytes = await ctx.storage.getObject(tsjFile.storageKey);
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as TilesetJson;
  return normalizeTsjForVendor(parsed, 16);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
function int(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** Same synonym expansion the MCP applies, so both sources match identical terms. */
const SYNONYMS: Record<string, string[]> = {
  desk: ["table", "workstation", "workdesk"],
  table: ["desk"],
  chair: ["seat", "stool", "deskchair"],
  seat: ["chair", "stool", "sofa"],
  sofa: ["couch", "settee"],
  couch: ["sofa"],
  plant: ["tree", "greenery", "foliage"],
  lamp: ["light", "lighting"],
  wall: ["partition", "divider"],
  door: ["doorway", "entrance"],
  screen: ["monitor", "display", "tv"],
  rug: ["carpet", "mat"],
};
function expandTerms(query: string | undefined): string[] {
  if (!query) return [];
  const base = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const set = new Set(base);
  for (const t of base) for (const s of SYNONYMS[t] ?? []) set.add(s);
  return [...set];
}
