import path from "node:path";
import { MapMcpError } from "../../errors.js";
import type { WorkspaceService } from "../workspace.js";
import { parseAssetRecord } from "./record.js";
import { matches, rank } from "./search.js";
import type { AssetQuery, AssetRecord, AssetRepository, ImageBlob, TilesetJson, TilesetRef } from "./types.js";

/**
 * Reads the asset catalog straight out of `assets/` in the workspace. This is the
 * default source, which is what makes the whole server usable — and its whole test
 * suite runnable — with no credentials and no network.
 */
export class LocalAssetRepository implements AssetRepository {
  readonly kind = "local" as const;

  private cache: Map<string, AssetRecord> | undefined;

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly defaults: { tileSize: number },
  ) {}

  /** Drop the in-memory catalog so the next call re-reads `assets/`. */
  invalidate(): void {
    this.cache = undefined;
  }

  private async load(): Promise<Map<string, AssetRecord>> {
    if (this.cache) return this.cache;
    const records = new Map<string, AssetRecord>();

    for (const id of await this.workspace.list("assets", { extensions: [".json"] })) {
      let payload: unknown;
      try {
        payload = await this.workspace.readJson(id);
      } catch {
        // A malformed catalog file must not take down search for every other asset.
        continue;
      }
      const entries = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { assets?: unknown })?.assets)
          ? ((payload as { assets: unknown[] }).assets)
          : [payload];

      for (const entry of entries) {
        const parsed = parseAssetRecord(entry, this.defaults);
        if ("record" in parsed) records.set(parsed.record.id, parsed.record);
      }
    }

    this.cache = records;
    return records;
  }

  async get(id: string): Promise<AssetRecord | null> {
    return (await this.load()).get(id) ?? null;
  }

  async search(query: AssetQuery): Promise<AssetRecord[]> {
    const all = [...(await this.load()).values()];
    return rank(all.filter((record) => matches(record, query)), query).slice(0, query.limit ?? 25);
  }

  async listTilesets(): Promise<TilesetRef[]> {
    const refs = new Map<string, TilesetRef>();

    for (const id of await this.workspace.list("tilesets", { extensions: [".tsj"] })) {
      const name = path.basename(id, ".tsj");
      let tileSize: number | undefined;
      let displayName: string | undefined;
      try {
        const tsj = await this.workspace.readJson<Record<string, unknown>>(id);
        if (typeof tsj.tilewidth === "number") tileSize = tsj.tilewidth;
        if (typeof tsj.name === "string") displayName = tsj.name;
      } catch {
        // Unreadable .tsj still counts as present; validate_map reports the detail.
      }
      refs.set(name, {
        id: name,
        vendored: true,
        path: id,
        ...(displayName ? { name: displayName } : {}),
        ...(tileSize === undefined ? {} : { tileSize }),
      });
    }

    // Tilesets an asset references but which are not vendored yet: worth surfacing.
    for (const record of (await this.load()).values()) {
      if (!refs.has(record.tilesetId)) {
        refs.set(record.tilesetId, { id: record.tilesetId, vendored: false, tileSize: record.tileSize });
      }
    }

    return [...refs.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async fetchTileset(id: string): Promise<{ tsj: TilesetJson; images: ImageBlob[] }> {
    const workspaceId = `tilesets/${path.basename(id, ".tsj")}.tsj`;
    if (!(await this.workspace.exists(workspaceId))) {
      throw new MapMcpError("ASSET_NOT_FOUND", `Tileset "${id}" is not present in the workspace`, {
        rule: "tileset-missing",
        path: workspaceId,
        fix: "Drop the .tsj and its atlas image into content/tilesets/, or set ASSET_SOURCE=api to pull it.",
      });
    }
    const tsj = await this.workspace.readJson<TilesetJson>(workspaceId);
    // Images are already on disk beside the .tsj; nothing to transfer.
    return { tsj, images: [] };
  }

  async health(): Promise<{ reachable: boolean; detail?: string }> {
    const count = (await this.load()).size;
    return { reachable: true, detail: `local catalog: ${count} asset${count === 1 ? "" : "s"} in content/assets/` };
  }
}
