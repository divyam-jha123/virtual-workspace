import type { MapMcpConfig } from "../../config.js";
import { MapMcpError } from "../../errors.js";
import { TILE_SIZE } from "../../schema/index.js";
import type { WorkspaceService } from "../workspace.js";
import { LocalAssetRepository } from "./local-repository.js";
import type { AssetQuery, AssetRecord, AssetRepository, ImageBlob, TilesetJson, TilesetRef } from "./types.js";

/** The per-tile image of a collection tileset. Grid atlases have none. */
function tileImageOf(tsj: TilesetJson, tileId: number): string | undefined {
  const tiles = tsj.tiles;
  if (!Array.isArray(tiles)) return undefined;
  for (const tile of tiles) {
    if (tile && typeof tile === "object" && (tile as { id?: unknown }).id === tileId) {
      const image = (tile as { image?: unknown }).image;
      if (typeof image === "string") return image;
    }
  }
  return undefined;
}

export interface AssetSourceStatus {
  /** Always "local" — the filesystem is the only source. */
  source: string;
  reachable: boolean;
  detail?: string;
  /** Tilesets present on disk and therefore usable with no network. */
  vendoredTilesets: number;
}

/**
 * Asset logic over the local catalog: ranking, tile-size compatibility, and
 * sprite previews. Assets are read from the workspace filesystem; there is no
 * asset database, asset API, or remote sync.
 */
export class AssetService {
  constructor(
    private readonly repository: AssetRepository,
    private readonly workspace: WorkspaceService,
    private readonly projectTileSize: number = TILE_SIZE,
  ) {}

  /** The catalog is read from `content/assets/` — no credentials, no network. */
  static fromConfig(_config: MapMcpConfig, workspace: WorkspaceService): AssetService {
    const local = new LocalAssetRepository(workspace, { tileSize: TILE_SIZE });
    return new AssetService(local, workspace);
  }

  get sourceKind(): string {
    return this.repository.kind;
  }

  async search(query: AssetQuery): Promise<AssetRecord[]> {
    // Assets drawn for another grid cannot be placed on this map at all, so the
    // project tile size is the default filter rather than a post-hoc warning.
    const effective: AssetQuery = { tileSize: this.projectTileSize, ...query };
    return this.repository.search(effective);
  }

  async get(id: string): Promise<AssetRecord> {
    const record = await this.repository.get(id);
    if (!record) {
      throw new MapMcpError("ASSET_NOT_FOUND", `No asset with id "${id}"`, {
        rule: "asset-missing",
        fix: "Call search_assets to find a valid id; ids are exact and case-sensitive.",
      });
    }
    return record;
  }

  /** Tilesets known to the project, scanned from `content/tilesets/`. */
  async listTilesets(): Promise<TilesetRef[]> {
    return this.repository.listTilesets();
  }

  /**
   * The sprite for one asset, so a person can pick art by looking at it instead
   * of guessing from an id like "office.chair-down".
   *
   * Read straight from the vendored `.tsj` and its atlas on disk — the same bytes
   * Tiled will open. Returns null rather than throwing: a missing preview must
   * never fail a search. Grid atlases have no per-tile image and would need
   * cropping to preview a single cell, so they return null too.
   */
  async previewOf(record: AssetRecord): Promise<ImageBlob | null> {
    try {
      const tsjId = `tilesets/${record.tilesetId}.tsj`;
      if (!(await this.workspace.exists(tsjId))) return null;
      const tsj = await this.workspace.readJson<TilesetJson>(tsjId);
      const filename = tileImageOf(tsj, record.tileId);
      if (!filename) return null;
      const id = `tilesets/${filename}`;
      if (!(await this.workspace.exists(id))) return null;
      return { filename, contentType: "image/png", bytes: await this.workspace.readBytes(id) };
    } catch {
      return null;
    }
  }

  async status(): Promise<AssetSourceStatus> {
    const health = await this.repository.health();
    const vendored = (await this.workspace.list("tilesets", { extensions: [".tsj"] })).length;
    return {
      source: this.repository.kind,
      reachable: health.reachable,
      ...(health.detail ? { detail: health.detail } : {}),
      vendoredTilesets: vendored,
    };
  }
}
