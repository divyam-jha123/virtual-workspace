import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { AppContext } from "../context.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { slugify } from "../lib/slug.js";
import { asyncHandler, parse } from "./http.js";
import { AssetImageResolver } from "../lib/asset-image.js";

const ASSET_TYPES = [
  "TILESET", "SPRITE", "SPRITE_SHEET", "CHARACTER", "OBJECT", "ENVIRONMENT",
  "BUILDING", "ANIMATION", "UI", "FONT", "MAP_RESOURCE", "OTHER",
] as const;
const PLACEMENTS = ["floor", "wall", "ceiling", "overlay"] as const;

const boxSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const collisionSchema = z.object({ blocking: z.boolean(), box: boxSchema.optional() }).nullable();
const interactionSchema = z.record(z.unknown()).and(z.object({ class: z.string() })).nullable();

const assetInput = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(ASSET_TYPES).optional(),
  category: z.string().optional(),
  subcategory: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
  author: z.string().optional(),
  version: z.string().optional(),
  tileSize: z.number().int().positive().optional(),
  widthTiles: z.number().int().positive().optional(),
  heightTiles: z.number().int().positive().optional(),
  placement: z.enum(PLACEMENTS).optional(),
  packId: z.string(),
  tilesetId: z.string().nullable().optional(),
  tilesetKey: z.string().nullable().optional(),
  tileId: z.number().int().min(0).nullable().optional(),
  collision: collisionSchema.optional(),
  interaction: interactionSchema.optional(),
  licenseId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const ASSET_INCLUDE = { tags: true, tileset: true, license: true, pack: true, files: true } as const;

async function resolveTilesetId(
  ctx: AppContext,
  input: { tilesetId?: string | null; tilesetKey?: string | null },
): Promise<string | null | undefined> {
  if (input.tilesetId !== undefined) return input.tilesetId;
  if (input.tilesetKey === undefined) return undefined;
  if (input.tilesetKey === null) return null;
  const tileset = await ctx.prisma.tileset.findUnique({ where: { key: input.tilesetKey } });
  if (!tileset) throw badRequest("unknown_tileset", `No tileset with key "${input.tilesetKey}"`);
  return tileset.id;
}

/** Connect tag labels/slugs, creating any that don't exist. */
async function tagConnect(ctx: AppContext, labels: string[]): Promise<{ id: string }[]> {
  const ids: { id: string }[] = [];
  for (const label of labels) {
    const slug = slugify(label);
    if (!slug) continue;
    const tag = await ctx.prisma.tag.upsert({
      where: { slug },
      update: {},
      create: { slug, label: label.trim() },
    });
    ids.push({ id: tag.id });
  }
  return ids;
}

export function createAssetsRouter(ctx: AppContext): Router {
  const router = Router();
  const { prisma } = ctx;

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const where: Prisma.AssetWhereInput = {};
      const packId = q(req.query.packId);
      const type = q(req.query.type);
      const tag = q(req.query.tag);
      const licenseId = q(req.query.licenseId);
      const search = q(req.query.q);
      const placeableOnly = req.query.placeable === "true";
      if (packId) where.packId = packId;
      if (type) where.type = type as Prisma.AssetWhereInput["type"];
      if (licenseId) where.licenseId = licenseId;
      if (tag) where.tags = { some: { slug: slugify(tag) } };
      if (placeableOnly) where.AND = [{ tilesetId: { not: null } }, { tileId: { not: null } }];
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { slug: { contains: search, mode: "insensitive" } },
          { category: { contains: search, mode: "insensitive" } },
          { tags: { some: { slug: { contains: slugify(search) } } } },
        ];
      }
      const items = await prisma.asset.findMany({ where, include: ASSET_INCLUDE, orderBy: { name: "asc" } });
      const images = new AssetImageResolver(ctx);
      res.json({ items: await Promise.all(items.map(async (a) => ({ ...decorate(a), imageUrl: await images.urlFor(a) }))) });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const asset = await findByIdOrSlug(prisma, req.params.id);
      if (!asset) throw notFound("asset not found");
      res.json({ ...decorate(asset), imageUrl: await new AssetImageResolver(ctx).urlFor(asset) });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const data = parse(assetInput, req.body);
      const slug = slugify(data.slug ?? data.name);
      if (await prisma.asset.findUnique({ where: { slug } })) {
        throw conflict("slug_taken", `An asset with slug "${slug}" already exists.`);
      }
      const tilesetId = (await resolveTilesetId(ctx, data)) ?? null;
      const tags = data.tags ? await tagConnect(ctx, data.tags) : [];
      const asset = await prisma.asset.create({
        data: {
          slug,
          name: data.name,
          description: data.description ?? null,
          type: data.type ?? "OBJECT",
          category: data.category ?? "uncategorized",
          subcategory: data.subcategory ?? null,
          style: data.style ?? null,
          source: data.source ?? null,
          sourceUrl: data.sourceUrl ?? null,
          author: data.author ?? null,
          version: data.version ?? "1",
          tileSize: data.tileSize ?? 16,
          widthTiles: data.widthTiles ?? 1,
          heightTiles: data.heightTiles ?? 1,
          placement: data.placement ?? "floor",
          packId: data.packId,
          tilesetId,
          tileId: data.tileId ?? null,
          collision: (data.collision ?? undefined) as Prisma.InputJsonValue | undefined,
          interaction: (data.interaction ?? undefined) as Prisma.InputJsonValue | undefined,
          licenseId: data.licenseId ?? null,
          tags: { connect: tags },
        },
        include: ASSET_INCLUDE,
      });
      res.status(201).json(decorate(asset));
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = await findByIdOrSlug(prisma, req.params.id);
      if (!existing) throw notFound("asset not found");
      const data = parse(assetInput.partial({ packId: true }), req.body);
      const tilesetId = await resolveTilesetId(ctx, data);
      const update: Prisma.AssetUpdateInput = {};
      if (data.name !== undefined) update.name = data.name;
      if (data.slug !== undefined) update.slug = slugify(data.slug);
      if (data.description !== undefined) update.description = data.description;
      if (data.type !== undefined) update.type = data.type;
      if (data.category !== undefined) update.category = data.category;
      if (data.subcategory !== undefined) update.subcategory = data.subcategory;
      if (data.style !== undefined) update.style = data.style;
      if (data.source !== undefined) update.source = data.source;
      if (data.sourceUrl !== undefined) update.sourceUrl = data.sourceUrl;
      if (data.author !== undefined) update.author = data.author;
      if (data.version !== undefined) update.version = data.version;
      if (data.tileSize !== undefined) update.tileSize = data.tileSize;
      if (data.widthTiles !== undefined) update.widthTiles = data.widthTiles;
      if (data.heightTiles !== undefined) update.heightTiles = data.heightTiles;
      if (data.placement !== undefined) update.placement = data.placement;
      if (data.tileId !== undefined) update.tileId = data.tileId;
      if (data.collision !== undefined) update.collision = (data.collision ?? Prisma.DbNull) as Prisma.InputJsonValue;
      if (data.interaction !== undefined) update.interaction = (data.interaction ?? Prisma.DbNull) as Prisma.InputJsonValue;
      if (tilesetId !== undefined) update.tileset = tilesetId ? { connect: { id: tilesetId } } : { disconnect: true };
      if (data.licenseId !== undefined) update.license = data.licenseId ? { connect: { id: data.licenseId } } : { disconnect: true };
      if (data.tags !== undefined) update.tags = { set: await tagConnect(ctx, data.tags) };

      const asset = await prisma.asset.update({ where: { id: existing.id }, data: update, include: ASSET_INCLUDE });
      res.json(decorate(asset));
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = await findByIdOrSlug(prisma, req.params.id);
      if (!existing) throw notFound("asset not found");
      await prisma.asset.delete({ where: { id: existing.id } });
      res.status(204).end();
    }),
  );

  return router;
}

function q(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

async function findByIdOrSlug(prisma: AppContext["prisma"], idOrSlug: string) {
  const byId = await prisma.asset.findUnique({ where: { id: idOrSlug }, include: ASSET_INCLUDE });
  if (byId) return byId;
  return prisma.asset.findUnique({ where: { slug: idOrSlug }, include: ASSET_INCLUDE });
}

type Decorated = Prisma.AssetGetPayload<{ include: typeof ASSET_INCLUDE }>;
function decorate(asset: Decorated) {
  const placeable = Boolean(asset.tileset?.key) && asset.tileId !== null;
  return {
    ...asset,
    tilesetKey: asset.tileset?.key ?? null,
    placeable,
    // Storage keys are internal; expose GET urls only.
    files: asset.files.map((f) => ({
      id: f.id,
      role: f.role,
      filename: f.filename,
      contentType: f.contentType,
      width: f.width,
      height: f.height,
      bytes: f.bytes,
      url: `/api/files/${encodeURIComponent(f.storageKey)}`,
    })),
  };
}
