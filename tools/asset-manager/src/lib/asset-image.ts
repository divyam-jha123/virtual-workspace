import type { AssetFile, Tileset } from "@prisma/client";
import type { AppContext } from "../context.js";
import type { TilesetJson } from "../tileset/tsj.js";

/**
 * Find the sprite for an asset.
 *
 * Files are stored against the TILESET, never the asset — an asset is a
 * `{tilesetId, tileId}` pair, not a file — so an asset's picture has to be
 * resolved through its tileset:
 *
 *   collection tileset -> the `.tsj` maps tileId to a per-tile image
 *   grid atlas         -> no per-tile image exists; the atlas is the best we have
 *
 * Getting this wrong is why a thumbnail silently renders blank: `asset.files` is
 * empty for every asset in the database.
 */

export interface AssetImageInput {
  tilesetId: string | null;
  tileId: number | null;
}

type TilesetWithFiles = Tileset & { files: AssetFile[] };

/** Reads each tileset's `.tsj` at most once per batch. */
export class AssetImageResolver {
  private readonly tilesets = new Map<string, TilesetWithFiles | null>();
  private readonly tsjs = new Map<string, TilesetJson | null>();

  constructor(private readonly ctx: AppContext) {}

  async urlFor(asset: AssetImageInput): Promise<string | null> {
    if (!asset.tilesetId) return null;
    const tileset = await this.tileset(asset.tilesetId);
    if (!tileset) return null;

    if (asset.tileId !== null) {
      const filename = await this.tileImageName(tileset, asset.tileId);
      if (filename) {
        const file = tileset.files.find((f) => f.role === "tile_image" && f.filename === filename);
        if (file) return fileUrl(file);
      }
    }

    // Grid atlas, or a collection tile whose image is missing: the atlas at least
    // shows the right art family rather than an empty box.
    const atlas = tileset.files.find((f) => f.role === "atlas");
    return atlas ? fileUrl(atlas) : null;
  }

  private async tileset(id: string): Promise<TilesetWithFiles | null> {
    if (!this.tilesets.has(id)) {
      this.tilesets.set(id, await this.ctx.prisma.tileset.findUnique({ where: { id }, include: { files: true } }));
    }
    return this.tilesets.get(id) ?? null;
  }

  private async tileImageName(tileset: TilesetWithFiles, tileId: number): Promise<string | undefined> {
    if (tileset.kind !== "collection") return undefined;
    const tsj = await this.tsj(tileset);
    if (!tsj || !Array.isArray(tsj.tiles)) return undefined;
    for (const tile of tsj.tiles) {
      if (tile && typeof tile === "object" && (tile as { id?: unknown }).id === tileId) {
        const image = (tile as { image?: unknown }).image;
        if (typeof image === "string") return image;
      }
    }
    return undefined;
  }

  private async tsj(tileset: TilesetWithFiles): Promise<TilesetJson | null> {
    if (!this.tsjs.has(tileset.id)) {
      const file = tileset.files.find((f) => f.role === "tsj");
      let parsed: TilesetJson | null = null;
      if (file) {
        try {
          parsed = JSON.parse(Buffer.from(await this.ctx.storage.getObject(file.storageKey)).toString("utf8")) as TilesetJson;
        } catch {
          parsed = null; // A broken .tsj must not break a listing.
        }
      }
      this.tsjs.set(tileset.id, parsed);
    }
    return this.tsjs.get(tileset.id) ?? null;
  }
}

/** Storage keys are internal; the browser only ever gets a GET route. */
function fileUrl(file: AssetFile): string {
  return `/api/files/${encodeURIComponent(file.storageKey)}`;
}
