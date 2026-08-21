import type { PrismaClient } from "@prisma/client";
import { CATALOG } from "../../../map-mcp/test/helpers/fixtures.js";

/** Distinct tilesets referenced by the fixture, with the fixture's tile sizes. */
const TILESETS: Record<string, number> = {};
for (const a of CATALOG) TILESETS[a.tilesetId] = a.tileSize;

/**
 * Wipe every table and load ONLY the map-mcp fixture CATALOG, so the live
 * contract test sees exactly what the in-process contract suite sees. Uses a
 * dedicated test database (DATABASE_URL points at it) — never the dev catalog.
 */
export async function seedFixtureCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.assetFile.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.tileset.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.assetPack.deleteMany();
  await prisma.license.deleteMany();

  // A single mixed-tile-size pack so per-asset tileSize (not pack flag) governs.
  const pack = await prisma.assetPack.create({
    data: { slug: "fixture", name: "Fixture", tileSize: null },
  });

  for (const [key, tileSize] of Object.entries(TILESETS)) {
    await prisma.tileset.create({
      data: {
        key,
        name: key,
        kind: "grid",
        tileWidth: tileSize,
        tileHeight: tileSize,
        columns: 8,
        tileCount: 256,
        packId: pack.id,
      },
    });
  }

  for (const a of CATALOG) {
    const tileset = await prisma.tileset.findUnique({ where: { key: a.tilesetId } });
    await prisma.asset.create({
      data: {
        slug: a.id,
        name: a.name,
        category: a.category,
        subcategory: "subcategory" in a ? (a.subcategory as string) : null,
        style: "style" in a ? (a.style as string) : null,
        tileSize: a.tileSize,
        widthTiles: a.dimensions.width,
        heightTiles: a.dimensions.height,
        placement: a.placement,
        tileId: a.tileId,
        tilesetId: tileset!.id,
        packId: pack.id,
        version: "version" in a ? (a.version as string) : "1",
        collision: "collision" in a ? (a.collision as object) : undefined,
        interaction: "interaction" in a ? (a.interaction as object) : undefined,
        tags: {
          connectOrCreate: a.tags.map((t) => ({
            where: { slug: t },
            create: { slug: t, label: t },
          })),
        },
      },
    });
  }
}
