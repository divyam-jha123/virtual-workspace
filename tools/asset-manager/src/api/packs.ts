import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { conflict, notFound } from "../lib/errors.js";
import { slugify } from "../lib/slug.js";
import { asyncHandler, parse } from "./http.js";

const packInput = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
  author: z.string().optional(),
  tileSize: z.number().int().positive().nullable().optional(),
  licenseId: z.string().nullable().optional(),
});

export function createPacksRouter(ctx: AppContext): Router {
  const router = Router();
  const { prisma } = ctx;

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const packs = await prisma.assetPack.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          license: true,
          _count: { select: { assets: true, tilesets: true } },
        },
      });
      res.json({
        items: packs.map((p) => ({
          ...p,
          nonPlaceableWarning: p.tileSize != null && p.tileSize !== 16,
          assetCount: p._count.assets,
          tilesetCount: p._count.tilesets,
        })),
      });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const data = parse(packInput, req.body);
      const slug = slugify(data.slug ?? data.name);
      if (await prisma.assetPack.findUnique({ where: { slug } })) {
        throw conflict("slug_taken", `A pack with slug "${slug}" already exists.`);
      }
      const pack = await prisma.assetPack.create({
        data: {
          slug,
          name: data.name,
          description: data.description ?? null,
          source: data.source ?? null,
          sourceUrl: data.sourceUrl ?? null,
          author: data.author ?? null,
          tileSize: data.tileSize ?? null,
          licenseId: data.licenseId ?? null,
        },
      });
      res.status(201).json(pack);
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const pack = await prisma.assetPack.findUnique({
        where: { id: req.params.id },
        include: { license: true, tilesets: true, _count: { select: { assets: true } } },
      });
      if (!pack) throw notFound("pack not found");
      res.json({ ...pack, nonPlaceableWarning: pack.tileSize != null && pack.tileSize !== 16 });
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const data = parse(packInput.partial(), req.body);
      const pack = await prisma.assetPack.update({
        where: { id: req.params.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.slug !== undefined ? { slug: slugify(data.slug) } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.source !== undefined ? { source: data.source } : {}),
          ...(data.sourceUrl !== undefined ? { sourceUrl: data.sourceUrl } : {}),
          ...(data.author !== undefined ? { author: data.author } : {}),
          ...(data.tileSize !== undefined ? { tileSize: data.tileSize } : {}),
          ...(data.licenseId !== undefined ? { licenseId: data.licenseId } : {}),
        },
      });
      res.json(pack);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await prisma.assetPack.delete({ where: { id: req.params.id } });
      res.status(204).end();
    }),
  );

  return router;
}
