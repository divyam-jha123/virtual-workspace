import path from "node:path";
import type { WorkspaceService } from "../workspace.js";
import { parseAssetRecord } from "./record.js";
import { matches, rank } from "./search.js";
import type { AssetQuery, AssetRecord, AssetRepository, TilesetRef } from "./types.js";

/**
 * Reads the asset catalog straight out of `assets/` in the workspace. The
 * filesystem is the only source: no credentials, no network, no asset database.
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

  async health(): Promise<{ reachable: boolean; detail?: string }> {
    const count = (await this.load()).size;
    return { reachable: true, detail: `local catalog: ${count} asset${count === 1 ? "" : "s"} in content/assets/` };
  }
}
