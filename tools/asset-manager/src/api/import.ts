import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { badRequest, notFound } from "../lib/errors.js";
import { sanitizeFilename } from "../lib/filenames.js";
import { pngSize } from "../lib/png.js";
import { LocalStorage } from "../storage/local-storage.js";
import { detectKind } from "../import/detect.js";
import { extractZip } from "../import/zip.js";
import { parseTsx } from "../import/tsx.js";
import { specFromTsj } from "../import/tsj-parse.js";
import type { TilesetSpec } from "../import/spec.js";
import { ingest, type IngestAsset, type IngestInput, type IngestTileset } from "../import/ingest.js";
import { asyncHandler, parse } from "./http.js";

/** Staged tileset: spec + resolved image storage keys + optional original .tsx. */
interface StagedTileset {
  spec: TilesetSpec;
  tsxStorageKey?: string;
}
interface StagedImage {
  name: string;
  storageKey: string;
  width?: number;
  height?: number;
}
interface StagedManifest {
  id: string;
  createdAt: string;
  pack: { name: string; slug?: string; tileSize?: number | null; source?: string; author?: string; description?: string };
  license?: IngestInput["license"];
  tilesets: StagedTileset[];
  images: StagedImage[];
  assets: IngestAsset[];
  warnings: string[];
}

const STAGING_PREFIX = "staging";

export function createImportRouter(ctx: AppContext): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ctx.config.maxUploadBytes, files: 500 },
  });

  // POST /api/import — stage & review (no DB writes).
  router.post(
    "/",
    upload.array("files"),
    asyncHandler(async (req, res) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw badRequest("no-files", "Attach at least one file under the 'files' field.");

      const fields = parse(
        z.object({
          packName: z.string().min(1),
          packSlug: z.string().optional(),
          tileSize: z.coerce.number().int().positive().optional(),
          source: z.string().optional(),
          author: z.string().optional(),
          description: z.string().optional(),
          licenseName: z.string().optional(),
          licenseUrl: z.string().optional(),
          attributionRequired: z.coerce.boolean().optional(),
          commercialUseAllowed: z.coerce.boolean().optional(),
          redistributionAllowed: z.coerce.boolean().optional(),
        }),
        req.body,
      );

      const images = new Map<string, StagedImage>();
      const tilesets: StagedTileset[] = [];
      const assets: IngestAsset[] = [];
      const warnings: string[] = [];

      const handleFile = async (filename: string, bytes: Uint8Array): Promise<void> => {
        const kind = detectKind(filename, bytes);
        if (kind === "png") {
          const name = sanitizeFilename(filename);
          const key = LocalStorage.newKey("png");
          await ctx.storage.putObject(key, bytes, "image/png");
          const size = pngSize(bytes);
          images.set(name, { name, storageKey: key, ...(size ?? {}) });
        } else if (kind === "tsx") {
          const spec = parseTsx(Buffer.from(bytes).toString("utf8"));
          const key = LocalStorage.newKey("tsx");
          await ctx.storage.putObject(key, bytes, "application/xml");
          tilesets.push({ spec, tsxStorageKey: key });
        } else if (kind === "tsj") {
          const spec = specFromTsj(JSON.parse(Buffer.from(bytes).toString("utf8")));
          tilesets.push({ spec });
        } else if (kind === "json") {
          collectAssetJson(JSON.parse(Buffer.from(bytes).toString("utf8")), assets, warnings);
        } else if (kind === "zip") {
          const entries = await extractZip(Buffer.from(bytes), {
            maxEntries: ctx.config.maxZipEntries,
            maxTotalBytes: ctx.config.maxZipTotalBytes,
            maxEntryBytes: ctx.config.maxUploadBytes,
          });
          for (const entry of entries) {
            const inner = detectKind(entry.name, entry.bytes);
            if (inner === "unknown") continue; // ignore READMEs etc.
            await handleFile(entry.name, entry.bytes);
          }
        } else {
          warnings.push(`Ignored "${filename}": unrecognized file type.`);
        }
      };

      for (const f of files) await handleFile(f.originalname, new Uint8Array(f.buffer));

      // Validate image coverage + tile-size warnings for the review screen.
      for (const ts of tilesets) {
        // Collection tilesets are normalized to the 16px map grid at commit
        // (each tile keeps its own image size), so only a non-16 GRID atlas is
        // genuinely unplaceable and hidden from the MCP.
        if (ts.spec.kind === "grid" && (ts.spec.tileWidth !== 16 || ts.spec.tileHeight !== 16)) {
          warnings.push(`Tileset "${ts.spec.name}" is a ${ts.spec.tileWidth}x${ts.spec.tileHeight}px grid — not 16px. It will be stored but hidden from the MCP.`);
        }
        const refs = ts.spec.kind === "grid" && ts.spec.image ? [ts.spec.image] : ts.spec.tiles.map((t) => t.image);
        const missing = refs.filter((r) => !images.has(sanitizeFilename(r)));
        if (missing.length > 0) warnings.push(`Tileset "${ts.spec.name}" is missing ${missing.length} image(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}.`);
      }
      if (fields.tileSize && fields.tileSize !== 16) {
        warnings.push(`Pack tileSize is ${fields.tileSize} (not 16); the whole pack will be excluded from /v1.`);
      }

      const manifest: StagedManifest = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        pack: {
          name: fields.packName,
          slug: fields.packSlug,
          tileSize: fields.tileSize ?? null,
          source: fields.source,
          author: fields.author,
          description: fields.description,
        },
        ...(fields.licenseName
          ? {
              license: {
                name: fields.licenseName,
                licenseName: fields.licenseName,
                licenseUrl: fields.licenseUrl,
                author: fields.author,
                sourceUrl: fields.source,
                attributionRequired: fields.attributionRequired,
                commercialUseAllowed: fields.commercialUseAllowed,
                redistributionAllowed: fields.redistributionAllowed,
              },
            }
          : {}),
        tilesets,
        images: [...images.values()],
        assets,
        warnings,
      };

      await ctx.storage.putObject(
        `${STAGING_PREFIX}/${manifest.id}.json`,
        new Uint8Array(Buffer.from(JSON.stringify(manifest), "utf8")),
        "application/json",
      );

      res.status(201).json(reviewOf(manifest, images));
    }),
  );

  // POST /api/import/:id/commit — promote a staged batch to the catalog.
  router.post(
    "/:id/commit",
    asyncHandler(async (req, res) => {
      const manifest = await loadManifest(ctx, req.params.id);
      if (!manifest) throw notFound("no such staged import (it may have expired)");

      const imagesByName = new Map(manifest.images.map((i) => [i.name, i]));
      const ingestTilesets: IngestTileset[] = [];
      for (const ts of manifest.tilesets) {
        const refs = ts.spec.kind === "grid" && ts.spec.image ? [ts.spec.image] : ts.spec.tiles.map((t) => t.image);
        const imgMap = new Map<string, Uint8Array>();
        for (const ref of refs) {
          const name = sanitizeFilename(ref);
          const staged = imagesByName.get(name);
          if (staged) imgMap.set(name, await ctx.storage.getObject(staged.storageKey));
        }
        const tsxXml = ts.tsxStorageKey ? Buffer.from(await ctx.storage.getObject(ts.tsxStorageKey)).toString("utf8") : undefined;
        ingestTilesets.push({ spec: ts.spec, images: imgMap, ...(tsxXml ? { tsxXml } : {}) });
      }

      const result = await ingest(ctx, {
        pack: manifest.pack,
        ...(manifest.license ? { license: manifest.license } : {}),
        tilesets: ingestTilesets,
        assets: manifest.assets,
      });

      // Best-effort staging cleanup.
      await ctx.storage.delete(`${STAGING_PREFIX}/${manifest.id}.json`).catch(() => {});
      res.json({ ...result, warnings: [...manifest.warnings, ...result.warnings] });
    }),
  );

  return router;
}

async function loadManifest(ctx: AppContext, id: string): Promise<StagedManifest | null> {
  const safe = id.replace(/[^A-Za-z0-9-]/g, "");
  try {
    const bytes = await ctx.storage.getObject(`${STAGING_PREFIX}/${safe}.json`);
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as StagedManifest;
  } catch {
    return null;
  }
}

function reviewOf(manifest: StagedManifest, images: Map<string, StagedImage>) {
  return {
    stagingId: manifest.id,
    pack: manifest.pack,
    license: manifest.license ?? null,
    warnings: manifest.warnings,
    tilesets: manifest.tilesets.map((ts) => {
      const refs = ts.spec.kind === "grid" && ts.spec.image ? [ts.spec.image] : ts.spec.tiles.map((t) => t.image);
      return {
        name: ts.spec.name,
        kind: ts.spec.kind,
        tileWidth: ts.spec.tileWidth,
        tileHeight: ts.spec.tileHeight,
        tileCount: ts.spec.tileCount,
        placeable: ts.spec.kind === "collection" || (ts.spec.tileWidth === 16 && ts.spec.tileHeight === 16),
        imagesTotal: refs.length,
        imagesPresent: refs.filter((r) => images.has(sanitizeFilename(r))).length,
        previewUrl: images.get(sanitizeFilename(refs[0] ?? ""))
          ? `/api/files/${encodeURIComponent(images.get(sanitizeFilename(refs[0]!))!.storageKey)}`
          : null,
      };
    }),
    looseImages: manifest.images.length,
    assets: manifest.assets.length,
  };
}

/** Pull asset records out of an uploaded catalog.json (array or {assets:[]}). */
function collectAssetJson(payload: unknown, out: IngestAsset[], warnings: string[]): void {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { assets?: unknown })?.assets)
      ? (payload as { assets: unknown[] }).assets
      : [payload];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const tilesetKey = typeof r.tilesetId === "string" ? r.tilesetId : typeof r.tileset === "string" ? r.tileset : undefined;
    const tileId = Number(r.tileId);
    if (!tilesetKey || !Number.isFinite(tileId)) {
      warnings.push(`Skipped a catalog record without tilesetId/tileId: ${String(r.id ?? r.name ?? "unnamed")}.`);
      continue;
    }
    const dims = (r.dimensions ?? {}) as { width?: number; height?: number };
    out.push({
      name: typeof r.name === "string" ? r.name : String(r.id ?? "asset"),
      slug: typeof r.id === "string" ? r.id : undefined,
      category: typeof r.category === "string" ? r.category : undefined,
      subcategory: typeof r.subcategory === "string" ? r.subcategory : undefined,
      style: typeof r.style === "string" ? r.style : undefined,
      tags: Array.isArray(r.tags) ? (r.tags.filter((t) => typeof t === "string") as string[]) : undefined,
      widthTiles: Number(dims.width) || 1,
      heightTiles: Number(dims.height) || 1,
      placement: (typeof r.placement === "string" ? r.placement : undefined) as IngestAsset["placement"],
      tilesetKey,
      tileId: Math.trunc(tileId),
      collision: r.collision,
      interaction: r.interaction,
      version: typeof r.version === "string" ? r.version : undefined,
    });
  }
}
