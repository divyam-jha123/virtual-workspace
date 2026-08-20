import type { MapMcpConfig } from "../../config.js";
import { MapMcpError } from "../../errors.js";
import { TILE_SIZE } from "../../schema/index.js";
import type { WorkspaceService } from "../workspace.js";
import { HttpAssetRepository } from "./http-repository.js";
import { LocalAssetRepository } from "./local-repository.js";
import type { AssetQuery, AssetRecord, AssetRepository, TilesetRef } from "./types.js";

export interface AssetSourceStatus {
  source: "local" | "api";
  reachable: boolean;
  detail?: string;
  /** Tilesets present on disk and therefore usable with no network. */
  vendoredTilesets: number;
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

  static fromConfig(config: MapMcpConfig, workspace: WorkspaceService): AssetService {
    const defaults = { tileSize: TILE_SIZE };
    if (config.assetSource === "api") {
      if (!config.assetApiUrl) {
        throw new MapMcpError("INVALID_ARGUMENT", "ASSET_SOURCE=api requires ASSET_API_URL", {
          rule: "asset-api-config",
          fix: "Set ASSET_API_URL (and ASSET_API_KEY), or leave ASSET_SOURCE=local to read content/assets/.",
        });
      }
      return new AssetService(
        new HttpAssetRepository({
          baseUrl: config.assetApiUrl,
          apiKey: config.assetApiKey,
          defaults,
          offline: config.offline,
        }),
        workspace,
      );
    }
    return new AssetService(new LocalAssetRepository(workspace, defaults), workspace);
  }

  get sourceKind(): "local" | "api" {
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
    return {
      source: this.repository.kind,
      reachable: health.reachable,
      ...(health.detail ? { detail: health.detail } : {}),
      vendoredTilesets: vendored,
    };
  }
}
