import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppContext } from "../context.js";
import { badRequest } from "../lib/errors.js";
import { sanitizeFilename } from "../lib/filenames.js";
import { normalizeTsjForVendor, imageReferences, type TilesetJson } from "../tileset/tsj.js";
import { toAssetRecord, type AssetWithRelations } from "../v1/dto.js";

const LOCKFILE = "asset-manager.lock.json";

export interface VendorOptions {
  /** Vendor only these tileset keys; omit for every placeable tileset. */
  tilesetKeys?: string[];
  /** Restrict to a pack. */
  packId?: string;
}

export interface VendorResult {
  tilesets: string[];
  images: string[];
  assets: string[];
  catalogPath: string;
  lockfilePath: string;
  skipped: string[];
  warnings: string[];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Atomic write inside a directory that must already exist. */
async function writeAtomic(absPath: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, absPath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Push placeable tilesets and their assets into the map-mcp workspace so the
 * already-connected local repository (ASSET_SOURCE=local) can search and place
 * them with no network. Writes:
 *   content/tilesets/<key>.tsj              (tilewidth/height forced to 16)
 *   content/tilesets/<image>.png            (every referenced image, by basename)
 *   content/assets/catalog.json             (merged; hand-authored ids preserved)
 *   content/tilesets/asset-manager.lock.json (reproducibility record)
 */
export async function vendor(ctx: AppContext, options: VendorOptions = {}): Promise<VendorResult> {
  const { prisma } = ctx;
  const contentDir = ctx.config.contentDir;
  const tilesetsDir = path.join(contentDir, "tilesets");
  const assetsDir = path.join(contentDir, "assets");
  await fs.mkdir(tilesetsDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const where = {
    tileWidth: 16,
    tileHeight: 16,
    ...(options.tilesetKeys ? { key: { in: options.tilesetKeys } } : {}),
    ...(options.packId ? { packId: options.packId } : {}),
  };
  const tilesets = await prisma.tileset.findMany({ where, include: { files: true } });

  const result: VendorResult = {
    tilesets: [], images: [], assets: [], skipped: [], warnings: [],
    catalogPath: "content/assets/catalog.json",
    lockfilePath: `content/tilesets/${LOCKFILE}`,
  };
  const lockTilesets: Array<{ key: string; version: string; tsjSha256: string; files: Array<{ name: string; sha256: string }> }> = [];

  for (const tileset of tilesets) {
    const tsjFile = tileset.files.find((f) => f.role === "tsj");
    if (!tsjFile) {
      result.skipped.push(`${tileset.key} (no .tsj on file)`);
      continue;
    }
    const canonical = JSON.parse(Buffer.from(await ctx.storage.getObject(tsjFile.storageKey)).toString("utf8")) as TilesetJson;
    const vendorTsj = normalizeTsjForVendor(canonical, 16);
    const tsjBytes = new Uint8Array(Buffer.from(`${JSON.stringify(vendorTsj, null, 2)}\n`, "utf8"));
    await writeAtomic(path.join(tilesetsDir, `${tileset.key}.tsj`), tsjBytes);
    result.tilesets.push(tileset.key);

    const fileHashes: Array<{ name: string; sha256: string }> = [{ name: `${tileset.key}.tsj`, sha256: sha256(tsjBytes) }];

    // Write every referenced image by basename, pulling bytes from storage.
    for (const ref of imageReferences(vendorTsj)) {
      const name = sanitizeFilename(ref);
      const fileRow = tileset.files.find(
        (f) => (f.role === "atlas" || f.role === "tile_image") && f.filename === name,
      );
      if (!fileRow) {
        result.warnings.push(`Tileset "${tileset.key}" references "${name}" but no stored image matches; Tiled will render it blank.`);
        continue;
      }
      const bytes = await ctx.storage.getObject(fileRow.storageKey);
      await writeAtomic(path.join(tilesetsDir, name), bytes);
      result.images.push(name);
      fileHashes.push({ name, sha256: sha256(bytes) });
    }

    lockTilesets.push({ key: tileset.key, version: tileset.version, tsjSha256: sha256(tsjBytes), files: fileHashes });
  }

  // Assets for the vendored tilesets -> catalog.json (merged).
  const vendoredKeys = new Set(result.tilesets);
  const assetRows = (await prisma.asset.findMany({
    where: {
      tileId: { not: null },
      tileset: { key: { in: [...vendoredKeys] } },
      tileSize: 16,
      pack: { OR: [{ tileSize: null }, { tileSize: 16 }] },
    },
    include: { tags: true, tileset: true, license: true },
  })) as AssetWithRelations[];

  const managed = assetRows
    .map(toAssetRecord)
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const managedIds = new Set(managed.map((r) => r.id));

  const catalogAbs = path.join(assetsDir, "catalog.json");
  const existing = await readCatalog(catalogAbs);
  // Keep every hand-authored record we don't manage; local overrides are preserved.
  const preserved = existing.filter((r) => !managedIds.has(r.id));
  const merged = [...preserved, ...managed].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  await writeAtomic(catalogAbs, new Uint8Array(Buffer.from(`${JSON.stringify({ assets: merged }, null, 2)}\n`, "utf8")));
  result.assets = managed.map((r) => r.id);

  const lock = {
    schema: 1,
    generator: "asset-manager",
    generatedAt: new Date().toISOString(),
    tilesets: lockTilesets,
    assets: result.assets,
  };
  await writeAtomic(path.join(tilesetsDir, LOCKFILE), new Uint8Array(Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, "utf8")));

  if (result.tilesets.length === 0) {
    result.warnings.push("No placeable (16px) tilesets matched — nothing was vendored.");
  }
  return result;
}

async function readCatalog(absPath: string): Promise<Array<{ id: string }>> {
  try {
    const text = await fs.readFile(absPath, "utf8");
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.assets) ? parsed.assets : [];
    return list.filter((r: unknown) => r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string");
  } catch {
    return [];
  }
}

export function assertVendorTarget(keys: string[] | undefined): void {
  if (keys && keys.some((k) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(k))) {
    throw badRequest("bad-tileset-key", "Tileset keys must be filename-safe.");
  }
}
