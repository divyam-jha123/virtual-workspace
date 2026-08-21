import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { asyncHandler, parse } from "./http.js";
import { slugify } from "../lib/slug.js";

export function createTagsRouter(ctx: AppContext): Router {
  const router = Router();
  const { prisma } = ctx;

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const tags = await prisma.tag.findMany({
        orderBy: { label: "asc" },
        include: { _count: { select: { assets: true } } },
      });
      res.json({ items: tags.map((t) => ({ id: t.id, slug: t.slug, label: t.label, assetCount: t._count.assets })) });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { label } = parse(z.object({ label: z.string().min(1) }), req.body);
      const slug = slugify(label);
      const tag = await prisma.tag.upsert({
        where: { slug },
        update: {},
        create: { slug, label: label.trim() },
      });
      res.status(201).json(tag);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await prisma.tag.delete({ where: { id: req.params.id } });
      res.status(204).end();
    }),
  );

  return router;
}
