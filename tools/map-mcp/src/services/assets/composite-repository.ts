import { MapMcpError, redact } from "../../errors.js";
import { rank } from "./search.js";
import type { AssetQuery, AssetRecord, AssetRepository, ImageBlob, TilesetJson, TilesetRef } from "./types.js";

export interface NamedRepository {
  name: string;
  repository: AssetRepository;
}

/**
 * Fans an asset lookup out across several sources — the local catalog plus zero
 * or more remote APIs — and presents the union through the same `AssetRepository`
 * seam every other implementation does.
 *
 * Precedence is config order: `sources[0]` always wins a same-id collision. The
 * local catalog is conventionally listed first by `AssetService.fromConfig`, so a
 * local record always shadows a same-id vendor record rather than the reverse —
 * an override always beats a vendor default.
 */
export class CompositeAssetRepository implements AssetRepository {
  readonly kind = "composite" as const;

  get sourceNames(): string[] {
    return this.sources.map((source) => source.name);
  }

  async healthOf(name: string): Promise<{ reachable: boolean; detail?: string }> {
    const source = this.sources.find((entry) => entry.name === name);
    if (!source) return { reachable: false, detail: `no source named "${name}"` };
    return source.repository.health();
  }

  constructor(private readonly sources: NamedRepository[]) {
    if (sources.length === 0) {
      throw new MapMcpError("INVALID_ARGUMENT", "CompositeAssetRepository needs at least one source", {
        rule: "asset-sources-empty",
        fix: "Pass at least the local repository.",
      });
    }
    const seen = new Set<string>();
    for (const { name } of sources) {
      if (seen.has(name)) {
        throw new MapMcpError("INVALID_ARGUMENT", `Duplicate asset source name "${name}"`, {
          rule: "asset-sources-duplicate-name",
          fix: "Give every entry in ASSET_APIS a distinct \"name\".",
        });
      }
      seen.add(name);
    }
  }

  /** First source, in config order, that has this id. */
  async get(id: string): Promise<AssetRecord | null> {
    for (const { repository } of this.sources) {
      const record = await repository.get(id);
      if (record) return record;
    }
    return null;
  }

  /**
   * Queries every source in parallel and merges. On a same-id collision the
   * earlier source's copy is kept; the merged set is then re-ranked exactly as a
   * single source would rank it, so ordering never reveals which source answered.
   */
  async search(query: AssetQuery): Promise<AssetRecord[]> {
    const perSource = await Promise.all(
      this.sources.map(async ({ repository }) => {
        try {
          // Ask each source for the full candidate pool; the merged, re-ranked
          // set is what gets truncated to the caller's limit, not each source's.
          return await repository.search({ ...query, limit: undefined });
        } catch {
          // One source being down must not fail a search the others can answer.
          return [];
        }
      }),
    );

    const merged = new Map<string, AssetRecord>();
    for (const records of perSource) {
      for (const record of records) if (!merged.has(record.id)) merged.set(record.id, record);
    }

    return rank([...merged.values()], query).slice(0, query.limit ?? 25);
  }

  async listTilesets(): Promise<TilesetRef[]> {
    const merged = new Map<string, TilesetRef>();
    for (const { repository } of this.sources) {
      let refs: TilesetRef[];
      try {
        refs = await repository.listTilesets();
      } catch {
        continue;
      }
      for (const ref of refs) {
        const existing = merged.get(ref.id);
        // First source wins the display fields too; only the vendored flag is OR'd,
        // since "usable offline" is true if ANY source vendored it.
        merged.set(ref.id, existing ? { ...existing, vendored: existing.vendored || ref.vendored } : ref);
      }
    }
    return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Tries each source in order; the first that actually has the tileset wins. */
  async fetchTileset(id: string, version?: string): Promise<{ tsj: TilesetJson; images: ImageBlob[] }> {
    let lastError: unknown;
    for (const { repository } of this.sources) {
      try {
        return await repository.fetchTileset(id, version);
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError instanceof MapMcpError) throw lastError;
    throw new MapMcpError("ASSET_NOT_FOUND", `No configured asset source has tileset "${id}"`, {
      rule: "tileset-missing",
      fix: "Call list_tilesets to see which sources and tilesets are available.",
    });
  }

  /** Reachable if ANY source is — the offline story still holds as long as one source works. */
  async health(): Promise<{ reachable: boolean; detail?: string }> {
    const results = await Promise.all(
      this.sources.map(async ({ name, repository }) => {
        const health = await repository.health();
        return { name, ...health };
      }),
    );
    const reachable = results.some((r) => r.reachable);
    const detail = results.map((r) => `${r.name}: ${r.reachable ? "reachable" : "unreachable"}${r.detail ? ` (${redact(r.detail)})` : ""}`).join("; ");
    return { reachable, detail };
  }
}
