import type { MapMcpConfig } from "../../config.js";
import { MapMcpError } from "../../errors.js";
import { TILE_SIZE } from "../../schema/index.js";
import type { WorkspaceService } from "../workspace.js";
import { CompositeAssetRepository } from "./composite-repository.js";
import { HttpAssetRepository } from "./http-repository.js";
import { LocalAssetRepository } from "./local-repository.js";
import type { AssetQuery, AssetRecord, AssetRepository, TilesetRef } from "./types.js";

export interface AssetSourceStatus {
  /** "local", "api", or "composite" when more than one source is configured. */
  source: string;
  reachable: boolean;
  detail?: string;
  /** Tilesets present on disk and therefore usable with no network. */
  vendoredTilesets: number;
  /** One entry per configured source; present only when more than one is active. */
  sources?: Array<{ name: string; reachable: boolean; detail?: string }>;
}

/**
 * Transport-agnostic asset logic: ranking, tile-size compatibility, and the
 * offline story. It knows there is a repository; it does not know whether that
 * repository is a folder or an HTTP API.
 */
export class AssetService {
  constructor(
    private readonly repository: AssetRepository,
    private readonly workspace: WorkspaceService,
    private readonly projectTileSize: number = TILE_SIZE,
  ) {}

  /**
   * The local catalog is always constructed and always listed first, so the
   * server stays usable with zero credentials even when remote sources are also
   * configured, and a local record always shadows a same-id vendor record.
   */
  static fromConfig(config: MapMcpConfig, workspace: WorkspaceService): AssetService {
    const defaults = { tileSize: TILE_SIZE };
    const local = new LocalAssetRepository(workspace, defaults);

    if (config.assetApis.length === 0) {
      return new AssetService(local, workspace);
    }

    const sources = [
      { name: "local", repository: local as AssetRepository },
      ...config.assetApis.map((api) => ({
        name: api.name,
        repository: new HttpAssetRepository({ baseUrl: api.url, apiKey: api.key, defaults, offline: config.offline }) as AssetRepository,
      })),
    ];
    return new AssetService(new CompositeAssetRepository(sources), workspace);
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

  /** Merges what the source knows with what is actually vendored on disk. */
  async listTilesets(): Promise<TilesetRef[]> {
    const vendored = new Map<string, TilesetRef>();
    for (const id of await this.workspace.list("tilesets", { extensions: [".tsj"] })) {
      const name = id.slice("tilesets/".length, -".tsj".length);
      vendored.set(name, { id: name, vendored: true, path: id });
    }

    let remote: TilesetRef[] = [];
    try {
      remote = await this.repository.listTilesets();
    } catch {
      // Offline or unauthorized: the vendored list alone is still the truth that
      // matters, because that is what Tiled and the runtime can actually open.
    }

    const merged = new Map(vendored);
    for (const ref of remote) {
      const existing = merged.get(ref.id);
      merged.set(ref.id, existing ? { ...ref, ...existing, vendored: true } : { ...ref, vendored: false });
    }
    return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async status(): Promise<AssetSourceStatus> {
    const health = await this.repository.health();
    const vendored = (await this.workspace.list("tilesets", { extensions: [".tsj"] })).length;
    const status: AssetSourceStatus = {
      source: this.repository.kind,
      reachable: health.reachable,
      ...(health.detail ? { detail: health.detail } : {}),
      vendoredTilesets: vendored,
    };
    const repository = this.repository;
    if (repository instanceof CompositeAssetRepository) {
      status.sources = await Promise.all(
        repository.sourceNames.map(async (name) => {
          const sourceHealth = await repository.healthOf(name);
          return { name, reachable: sourceHealth.reachable, ...(sourceHealth.detail ? { detail: sourceHealth.detail } : {}) };
        }),
      );
    }
    return status;
  }
}
