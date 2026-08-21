import type { Prisma, Tileset } from "@prisma/client";
import type { AppContext } from "../context.js";
import { LocalStorage } from "../storage/local-storage.js";
import { pngSize } from "../lib/png.js";
import { slugify, tilesetKey as toTilesetKey } from "../lib/slug.js";
import { sanitizeFilename } from "../lib/filenames.js";
import { specToTsj, type TilesetSpec } from "./spec.js";

export interface IngestTileset {
  spec: TilesetSpec;
  /** Original .tsx XML, stored unmodified for provenance. */
  tsxXml?: string;
  /** basename -> PNG bytes. Must cover every image the spec references. */
  images: Map<string, Uint8Array>;
  /** Override the derived key. */
  key?: string;
}

export interface IngestAsset {
  name: string;
  slug?: string;
  description?: string;
  type?: Prisma.AssetCreateInput["type"];
  category?: string;
  subcategory?: string;
  style?: string;
  tags?: string[];
  widthTiles?: number;
  heightTiles?: number;
  placement?: Prisma.AssetCreateInput["placement"];
  tilesetKey: string;
  tileId: number;
  collision?: unknown;
  interaction?: unknown;
  version?: string;
  author?: string;
  sourceUrl?: string;
}

export interface IngestInput {
  pack: {
    name: string;
    slug?: string;
    description?: string;
    source?: string;
    sourceUrl?: string;
    author?: string;
    /** When set and != 16 the pack is flagged non-placeable and hidden from /v1. */
    tileSize?: number | null;
  };
  license?: {
    name: string;
    licenseName?: string;
    licenseUrl?: string;
    author?: string;
    sourceUrl?: string;
    attributionRequired?: boolean;
    commercialUseAllowed?: boolean;
    redistributionAllowed?: boolean;
    notes?: string;
  };
  tilesets: IngestTileset[];
  assets: IngestAsset[];
}

export interface IngestResult {
  packId: string;
  packSlug: string;
  tilesetKeys: string[];
  assetSlugs: string[];
  warnings: string[];
}

async function storeBytes(
  ctx: AppContext,
  bytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<{ storageKey: string; filename: string; contentType: string; bytes: number; sha256: string; width?: number; height?: number }> {
  const ext = filename.includes(".") ? filename.split(".").pop()! : "bin";
  const key = LocalStorage.newKey(ext);
  await ctx.storage.putObject(key, bytes, contentType);
  const size = pngSize(bytes);
  return {
    storageKey: key,
    filename,
    contentType,
    bytes: bytes.byteLength,
    sha256: LocalStorage.sha256(bytes),
    ...(size ? { width: size.width, height: size.height } : {}),
  };
}

/** Create Pack, Tilesets, Assets and their AssetFiles from a fully-resolved
 *  spec. Idempotent-ish: an existing pack slug is reused; existing tileset keys
 *  are updated in place. */
export async function ingest(ctx: AppContext, input: IngestInput): Promise<IngestResult> {
  const { prisma } = ctx;
  const warnings: string[] = [];

  let licenseId: string | null = null;
  if (input.license) {
    const license = await prisma.license.create({
      data: {
        name: input.license.name,
        licenseName: input.license.licenseName ?? null,
        licenseUrl: input.license.licenseUrl ?? null,
        author: input.license.author ?? null,
        sourceUrl: input.license.sourceUrl ?? null,
        attributionRequired: input.license.attributionRequired ?? true,
        commercialUseAllowed: input.license.commercialUseAllowed ?? true,
        redistributionAllowed: input.license.redistributionAllowed ?? true,
        notes: input.license.notes ?? null,
      },
    });
    licenseId = license.id;
  }

  const packSlug = slugify(input.pack.slug ?? input.pack.name);
  const pack = await prisma.assetPack.upsert({
    where: { slug: packSlug },
    update: {
      name: input.pack.name,
      description: input.pack.description ?? null,
      source: input.pack.source ?? null,
      sourceUrl: input.pack.sourceUrl ?? null,
      author: input.pack.author ?? null,
      tileSize: input.pack.tileSize ?? null,
      ...(licenseId ? { licenseId } : {}),
    },
    create: {
      slug: packSlug,
      name: input.pack.name,
      description: input.pack.description ?? null,
      source: input.pack.source ?? null,
      sourceUrl: input.pack.sourceUrl ?? null,
      author: input.pack.author ?? null,
      tileSize: input.pack.tileSize ?? null,
      licenseId,
    },
  });

  if (input.pack.tileSize != null && input.pack.tileSize !== 16) {
    warnings.push(
      `Pack "${pack.name}" targets ${input.pack.tileSize}px tiles, not 16px. It is stored but EXCLUDED from every /v1 response, so the map MCP will never see it.`,
    );
  }

  const tilesetKeys: string[] = [];
  const keyByName = new Map<string, string>();

  for (const raw of input.tilesets) {
    // A collection tileset's declared tilewidth/height is just Tiled's default
    // cell (a bounding box); each tile renders at its own image size. On a 16px
    // map the grid IS 16, so we normalize collection tilesets to 16 — this is
    // what makes the office props (declared 46x61) placeable and matches what
    // normalizeTsjForVendor writes.
    const spec =
      raw.spec.kind === "collection" ? { ...raw.spec, tileWidth: 16, tileHeight: 16 } : raw.spec;
    const it: IngestTileset = { ...raw, spec };
    const key = it.key ?? toTilesetKey(`${packSlug}-${it.spec.name}`);
    const tsjJson = specToTsj({ ...it.spec, name: key });
    const placeable = it.spec.tileWidth === 16 && it.spec.tileHeight === 16;
    if (!placeable) {
      warnings.push(
        `Tileset "${key}" is drawn for ${it.spec.tileWidth}x${it.spec.tileHeight}px tiles; it is hidden from /v1 (the MCP only places 16px art).`,
      );
    }

    const tileset = await prisma.tileset.upsert({
      where: { key },
      update: {
        name: key,
        kind: it.spec.kind,
        tileWidth: it.spec.tileWidth,
        tileHeight: it.spec.tileHeight,
        columns: it.spec.columns,
        tileCount: it.spec.tileCount,
        imageWidth: it.spec.imageWidth ?? null,
        imageHeight: it.spec.imageHeight ?? null,
        packId: pack.id,
      },
      create: {
        key,
        name: key,
        kind: it.spec.kind,
        tileWidth: it.spec.tileWidth,
        tileHeight: it.spec.tileHeight,
        columns: it.spec.columns,
        tileCount: it.spec.tileCount,
        imageWidth: it.spec.imageWidth ?? null,
        imageHeight: it.spec.imageHeight ?? null,
        packId: pack.id,
      },
    });

    // Replace any prior files for this tileset so re-ingest stays clean.
    await prisma.assetFile.deleteMany({ where: { tilesetId: tileset.id } });

    await storeTilesetFiles(ctx, tileset, it, tsjJson);
    tilesetKeys.push(key);
    keyByName.set(it.spec.name, key);
  }

  const assetSlugs: string[] = [];
  for (const a of input.assets) {
    const key = keyByName.get(a.tilesetKey) ?? a.tilesetKey;
    const tileset = await prisma.tileset.findUnique({ where: { key } });
    if (!tileset) {
      warnings.push(`Asset "${a.name}" references unknown tileset "${a.tilesetKey}"; skipped.`);
      continue;
    }
    const slug = slugify(a.slug ?? `${packSlug}-${a.name}`);
    await prisma.asset.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        name: a.name,
        description: a.description ?? null,
        type: a.type ?? "OBJECT",
        category: a.category ?? "uncategorized",
        subcategory: a.subcategory ?? null,
        style: a.style ?? null,
        version: a.version ?? "1",
        author: a.author ?? input.pack.author ?? null,
        sourceUrl: a.sourceUrl ?? null,
        tileSize: tileset.tileWidth,
        widthTiles: a.widthTiles ?? 1,
        heightTiles: a.heightTiles ?? 1,
        placement: a.placement ?? "floor",
        packId: pack.id,
        tilesetId: tileset.id,
        tileId: a.tileId,
        licenseId,
        collision: (a.collision ?? undefined) as Prisma.InputJsonValue | undefined,
        interaction: (a.interaction ?? undefined) as Prisma.InputJsonValue | undefined,
        ...(a.tags && a.tags.length
          ? {
              tags: {
                connectOrCreate: a.tags.map((label) => ({
                  where: { slug: slugify(label) },
                  create: { slug: slugify(label), label: label.trim() },
                })),
              },
            }
          : {}),
      },
    });
    assetSlugs.push(slug);
  }

  return { packId: pack.id, packSlug, tilesetKeys, assetSlugs, warnings };
}

async function storeTilesetFiles(
  ctx: AppContext,
  tileset: Tileset,
  it: IngestTileset,
  tsjJson: Record<string, unknown>,
): Promise<void> {
  const { prisma } = ctx;

  const tsjBytes = new Uint8Array(Buffer.from(`${JSON.stringify(tsjJson, null, 2)}\n`, "utf8"));
  const tsjFile = await storeBytes(ctx, tsjBytes, `${tileset.key}.tsj`, "application/json");
  await prisma.assetFile.create({ data: { role: "tsj", tilesetId: tileset.id, ...tsjFile } });

  if (it.tsxXml) {
    const tsxFile = await storeBytes(ctx, new Uint8Array(Buffer.from(it.tsxXml, "utf8")), `${tileset.key}.tsx`, "application/xml");
    await prisma.assetFile.create({ data: { role: "tsx", tilesetId: tileset.id, ...tsxFile } });
  }

  if (it.spec.kind === "grid" && it.spec.image) {
    const name = sanitizeFilename(it.spec.image);
    const bytes = it.images.get(name);
    if (bytes) {
      const stored = await storeBytes(ctx, bytes, name, "image/png");
      await prisma.assetFile.create({ data: { role: "atlas", tilesetId: tileset.id, ...stored } });
    }
  } else {
    for (const tile of it.spec.tiles) {
      const name = sanitizeFilename(tile.image);
      const bytes = it.images.get(name);
      if (!bytes) continue;
      const stored = await storeBytes(ctx, bytes, name, "image/png");
      await prisma.assetFile.create({ data: { role: "tile_image", tilesetId: tileset.id, ...stored } });
    }
  }
}
