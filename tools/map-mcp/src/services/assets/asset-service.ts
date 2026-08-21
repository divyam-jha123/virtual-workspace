import type { MapMcpConfig } from "../../config.js";
import { MapMcpError, redact } from "../../errors.js";
import { TILE_SIZE } from "../../schema/index.js";
import type { WorkspaceService } from "../workspace.js";
import { CompositeAssetRepository } from "./composite-repository.js";
import { HttpAssetRepository, imageReferences } from "./http-repository.js";
import { LocalAssetRepository } from "./local-repository.js";
import type { AssetQuery, AssetRecord, AssetRepository, ImageBlob, SelectionSession, TilesetJson, TilesetRef } from "./types.js";

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

export interface TilesetSyncReport {
  id: string;
  /** Workspace ids written, images first. Empty when the tileset was already on disk. */
  files: string[];
  /** Images the `.tsj` references that did not land; Tiled renders those tiles blank. */
  missingImages: string[];
}

export interface TilesetSyncResult {
  synced: TilesetSyncReport[];
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; reason: string }>;
}

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

  /**
   * Pull one tileset onto disk: the `.tsj` plus every image it references.
   *
   * This is the client half of vendoring — the same bytes the Asset Manager's
   * vendor step pushes, fetched instead of pushed, so a remote catalog needs no
   * manual sync step. Images are written *before* the `.tsj` so a reader (Tiled,
   * the validator) never sees a tileset pointing at art that has not landed yet.
   *
   * `ImageBlob.filename` is a basename by contract, and every write still goes
   * through the workspace path jail, so a hostile `.tsj` cannot place bytes
   * outside `tilesets/`.
   */
  async syncTileset(id: string, options: { force?: boolean } = {}): Promise<TilesetSyncReport> {
    const force = options.force ?? false;
    if (!force && (await this.workspace.exists(`tilesets/${id}.tsj`))) {
      return { id, files: [], missingImages: [] };
    }
    return this.pull(id, force);
  }

  /**
   * Fetch and write, with existence already decided by the caller.
   *
   * `preferRemote` is the user's `force`, not "we already checked the file":
   * conflating the two would make every ordinary sync skip the local catalog.
   * On a forced refresh the local copy is the stale thing being replaced, so a
   * local-first composite must not be allowed to answer with it.
   */
  private async pull(id: string, preferRemote: boolean): Promise<TilesetSyncReport> {
    const workspaceId = `tilesets/${id}.tsj`;
    const { tsj, images } =
      preferRemote && this.repository instanceof CompositeAssetRepository
        ? await this.repository.fetchTilesetFromRemote(id)
        : await this.repository.fetchTileset(id);

    const files: string[] = [];
    for (const image of images) {
      files.push(this.workspace.relative(await this.workspace.writeBytes(`tilesets/${image.filename}`, image.bytes)));
    }
    files.push(this.workspace.relative(await this.workspace.writeJson(workspaceId, tsj)));

    const missingImages: string[] = [];
    for (const reference of imageReferences(tsj)) {
      // A reference with a directory component is rejected by the path jail
      // rather than answered — treat that as missing too, not as a crash.
      const present = await this.workspace.exists(`tilesets/${reference}`).catch(() => false);
      if (!present) missingImages.push(reference);
    }
    return { id, files, missingImages };
  }

  /**
   * Sync many tilesets. With no ids, pulls everything the source knows about that
   * is not already on disk. One tileset failing never stops the rest — the report
   * says which landed, which were already there, and which could not be fetched.
   */
  async syncTilesets(ids?: string[], options: { force?: boolean } = {}): Promise<TilesetSyncResult> {
    const force = options.force ?? false;
    const targets = ids?.length
      ? ids
      : (await this.listTilesets()).filter((ref) => !ref.vendored).map((ref) => ref.id);

    const result: TilesetSyncResult = { synced: [], skipped: [], failed: [] };
    for (const id of targets) {
      try {
        if (!force && (await this.workspace.exists(`tilesets/${id}.tsj`))) {
          result.skipped.push({ id, reason: "already on disk" });
          continue;
        }
        result.synced.push(await this.pull(id, force));
      } catch (err) {
        result.failed.push({ id, reason: redact(err instanceof Error ? err.message : String(err)) });
      }
    }
    return result;
  }

  /**
   * The sprite for one asset, so a person can pick art by looking at it instead
   * of guessing from an id like "office.chair-down".
   *
   * Deliberately reuses the vendored files rather than adding a second fetch
   * path: `syncTileset` puts the tileset on disk (a no-op once it is there), and
   * the preview is read from the same bytes Tiled will open. Syncing to preview
   * is not wasted work — placing any of these assets needs those files anyway.
   *
   * Returns null rather than throwing: a missing preview must never fail a
   * search. Grid atlases have no per-tile image and would need cropping to
   * preview a single cell, so they return null too.
   */
  async previewOf(record: AssetRecord): Promise<ImageBlob | null> {
    try {
      await this.syncTileset(record.tilesetId);
      const tsj = await this.workspace.readJson<TilesetJson>(`tilesets/${record.tilesetId}.tsj`);
      const filename = tileImageOf(tsj, record.tileId);
      if (!filename) return null;
      const id = `tilesets/${filename}`;
      if (!(await this.workspace.exists(id))) return null;
      return { filename, contentType: "image/png", bytes: await this.workspace.readBytes(id) };
    } catch {
      return null;
    }
  }

  /**
   * Ask a person to choose one of these assets in a browser.
   *
   * Returns as soon as the question is registered — it does not wait. Waiting is
   * `awaitSelection`, kept separate so a caller can hand over the link first and
   * poll after, rather than going silent for minutes.
   */
  async createSelection(prompt: string, candidateIds: string[], ttlSeconds?: number): Promise<SelectionSession> {
    if (typeof this.repository.createSelection !== "function") {
      throw new MapMcpError("INVALID_ARGUMENT", "This asset source cannot host a browser selection", {
        rule: "no-selection-source",
        fix: "Configure ASSET_APIS with an asset API that serves /selections, or choose an asset by id with place_asset.",
      });
    }
    return this.repository.createSelection({
      prompt,
      candidateIds,
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    });
  }

  async readSelection(token: string): Promise<SelectionSession> {
    if (typeof this.repository.readSelection !== "function") {
      throw new MapMcpError("INVALID_ARGUMENT", "This asset source cannot host a browser selection", {
        rule: "no-selection-source",
        fix: "Configure ASSET_APIS with an asset API that serves /selections.",
      });
    }
    return this.repository.readSelection(token);
  }

  /**
   * Poll until the question is answered or `waitMs` runs out.
   *
   * A timeout is NOT an error and does not cancel anything: the link stays live,
   * and the caller can wait again with the same token. That keeps a slow human
   * from losing their place just because a tool call had to return.
   */
  async awaitSelection(
    token: string,
    options: { waitMs?: number; pollMs?: number } = {},
  ): Promise<{ selection: SelectionSession; timedOut: boolean }> {
    const waitMs = Math.max(0, options.waitMs ?? 120_000);
    const pollMs = Math.min(Math.max(options.pollMs ?? 1_500, 250), 10_000);
    const deadline = Date.now() + waitMs;

    for (;;) {
      const selection = await this.readSelection(token);
      if (selection.status !== "pending") return { selection, timedOut: false };
      if (Date.now() + pollMs > deadline) return { selection, timedOut: true };
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  async cancelSelection(token: string): Promise<SelectionSession> {
    if (typeof this.repository.cancelSelection !== "function") {
      throw new MapMcpError("INVALID_ARGUMENT", "This asset source cannot host a browser selection", {
        rule: "no-selection-source",
        fix: "Configure ASSET_APIS with an asset API that serves /selections.",
      });
    }
    return this.repository.cancelSelection(token);
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
