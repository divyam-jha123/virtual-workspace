import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { AppContext } from "../context.js";
import { badRequest, notFound } from "../lib/errors.js";
import { slugify } from "../lib/slug.js";
import { asyncHandler, parse } from "./http.js";
import type { TilesetJson } from "../tileset/tsj.js";

/** A tile the inspector can render and turn into an asset. */
interface TileView {
  tileId: number;
  image?: string;
  imageUrl?: string;
  width: number;
  height: number;
  /** For a grid tileset: pixel offset into the atlas. */
  atlas?: { x: number; y: number };
}

async function tileViews(ctx: AppContext, tilesetKey: string): Promise<TileView[]> {
  const tileset = await ctx.prisma.tileset.findUnique({ where: { key: tilesetKey }, include: { files: true } });
  if (!tileset) throw notFound(`No tileset "${tilesetKey}"`);
  const tsjFile = tileset.files.find((f) => f.role === "tsj");
  const tiles: TileView[] = [];

  if (tileset.kind === "collection" && tsjFile) {
    const tsj = JSON.parse(Buffer.from(await ctx.storage.getObject(tsjFile.storageKey)).toString("utf8")) as TilesetJson;
    const list = Array.isArray(tsj.tiles) ? tsj.tiles : [];
    for (const entry of list) {
      const t = entry as { id?: number; image?: string; imagewidth?: number; imageheight?: number };
      const filename = t.image ? t.image.split("/").pop()! : undefined;
      const fileRow = tileset.files.find((f) => f.role === "tile_image" && f.filename === filename);
      tiles.push({
        tileId: Number(t.id ?? 0),
        image: filename,
        imageUrl: fileRow ? `/api/files/${encodeURIComponent(fileRow.storageKey)}` : undefined,
        width: t.imagewidth ?? fileRow?.width ?? tileset.tileWidth,
        height: t.imageheight ?? fileRow?.height ?? tileset.tileHeight,
      });
    }
  } else {
    // Grid: tileId 0..tilecount-1, left-to-right / top-to-bottom.
    const cols = tileset.columns || 1;
    for (let i = 0; i < tileset.tileCount; i += 1) {
      tiles.push({
        tileId: i,
        width: tileset.tileWidth,
        height: tileset.tileHeight,
        atlas: { x: (i % cols) * tileset.tileWidth, y: Math.floor(i / cols) * tileset.tileHeight },
      });
    }
  }
  return tiles;
}

const PLACEMENTS = ["floor", "wall", "ceiling", "overlay"] as const;
const assetFromTile = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  tileId: z.number().int().min(0),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  style: z.string().optional(),
  type: z.string().optional(),
  widthTiles: z.number().int().positive().optional(),
  heightTiles: z.number().int().positive().optional(),
  placement: z.enum(PLACEMENTS).optional(),
  collision: z.object({ blocking: z.boolean(), box: z.any().optional() }).nullable().optional(),
  interaction: z.record(z.unknown()).and(z.object({ class: z.string() })).nullable().optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export function createTilesetsRouter(ctx: AppContext): Router {
  const router = Router();
  const { prisma } = ctx;

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const packId = typeof req.query.packId === "string" ? req.query.packId : undefined;
      const rows = await prisma.tileset.findMany({
        where: packId ? { packId } : {},
        orderBy: { key: "asc" },
        include: { pack: true, _count: { select: { assets: true } } },
      });
      res.json({
        items: rows.map((t) => ({
          id: t.id,
          key: t.key,
          name: t.name,
          kind: t.kind,
          tileWidth: t.tileWidth,
          tileHeight: t.tileHeight,
          columns: t.columns,
          tileCount: t.tileCount,
          imageWidth: t.imageWidth,
          imageHeight: t.imageHeight,
          version: t.version,
          packId: t.packId,
          packName: t.pack.name,
          assetCount: t._count.assets,
          placeable: t.tileWidth === 16 && t.tileHeight === 16,
        })),
      });
    }),
  );

  router.get(
    "/:key",
    asyncHandler(async (req, res) => {
      const tileset = await prisma.tileset.findUnique({
        where: { key: req.params.key },
        include: { files: true, pack: true },
      });
      if (!tileset) throw notFound("tileset not found");
      const atlas = tileset.files.find((f) => f.role === "atlas");
      res.json({
        id: tileset.id,
        key: tileset.key,
        name: tileset.name,
        kind: tileset.kind,
        tileWidth: tileset.tileWidth,
        tileHeight: tileset.tileHeight,
        columns: tileset.columns,
        tileCount: tileset.tileCount,
        imageWidth: tileset.imageWidth,
        imageHeight: tileset.imageHeight,
        version: tileset.version,
        packId: tileset.packId,
        packName: tileset.pack.name,
        placeable: tileset.tileWidth === 16 && tileset.tileHeight === 16,
        gridSize: 16,
        atlasUrl: atlas ? `/api/files/${encodeURIComponent(atlas.storageKey)}` : null,
        tiles: await tileViews(ctx, tileset.key),
      });
    }),
  );

  // Serve the single-atlas image directly (grid tilesets).
  router.get(
    "/:key/atlas",
    asyncHandler(async (req, res) => {
      const tileset = await prisma.tileset.findUnique({ where: { key: req.params.key }, include: { files: true } });
      if (!tileset) throw notFound("tileset not found");
      const atlas = tileset.files.find((f) => f.role === "atlas");
      if (!atlas) throw notFound("this tileset has no single atlas image");
      const bytes = await ctx.storage.getObject(atlas.storageKey);
      res.setHeader("Content-Type", "image/png");
      res.status(200).end(Buffer.from(bytes));
    }),
  );

  // Turn a selected tile (or rectangle, via widthTiles/heightTiles) into an Asset.
  router.post(
    "/:key/assets",
    asyncHandler(async (req, res) => {
      const tileset = await prisma.tileset.findUnique({ where: { key: req.params.key } });
      if (!tileset) throw notFound("tileset not found");
      const body = parse(assetFromTile, req.body);
      const slug = slugify(body.slug ?? `${tileset.key}-${body.name}`);
      if (await prisma.asset.findUnique({ where: { slug } })) {
        throw badRequest("slug_taken", `An asset with slug "${slug}" already exists.`);
      }
      const asset = await prisma.asset.create({
        data: {
          slug,
          name: body.name,
          description: body.description ?? null,
          type: (body.type as Prisma.AssetCreateInput["type"]) ?? "OBJECT",
          category: body.category ?? "uncategorized",
          subcategory: body.subcategory ?? null,
          style: body.style ?? null,
          tileSize: tileset.tileWidth,
          widthTiles: body.widthTiles ?? 1,
          heightTiles: body.heightTiles ?? 1,
          placement: body.placement ?? "floor",
          tileId: body.tileId,
          collision: (body.collision ?? undefined) as Prisma.InputJsonValue | undefined,
          interaction: (body.interaction ?? undefined) as Prisma.InputJsonValue | undefined,
          pack: { connect: { id: tileset.packId } },
          tileset: { connect: { id: tileset.id } },
          ...(body.tags && body.tags.length
            ? {
                tags: {
                  connectOrCreate: body.tags.map((label) => ({
                    where: { slug: slugify(label) },
                    create: { slug: slugify(label), label: label.trim() },
                  })),
                },
              }
            : {}),
        },
        include: { tags: true, tileset: true },
      });
      res.status(201).json({ ...asset, tilesetKey: asset.tileset?.key ?? null, placeable: true });
    }),
  );

  return router;
}
