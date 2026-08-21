import { MapMcpError, redact } from "../../errors.js";
import { rank } from "./search.js";
import type { AssetQuery, AssetRecord, AssetRepository, CreateSelectionInput, ImageBlob, SelectionSession, TilesetJson, TilesetRef } from "./types.js";

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

  /**
   * Fetch while ignoring the local catalog.
   *
   * Local-first precedence is right for reading — an override should shadow a
   * vendor record — but wrong for a deliberate refresh, where the local copy is
   * exactly the stale thing being replaced. Without this, `sync_tilesets --force`
   * would "succeed" by handing back the file it was asked to overwrite.
   */
  async fetchTilesetFromRemote(id: string, version?: string): Promise<{ tsj: TilesetJson; images: ImageBlob[] }> {
    const remote = this.sources.filter((source) => source.repository.kind !== "local");
    if (remote.length === 0) {
      throw new MapMcpError("ASSET_NOT_FOUND", `No remote asset source is configured, so tileset "${id}" cannot be refreshed`, {
        rule: "no-remote-source",
        fix: "Configure ASSET_APIS with a source that serves this tileset, or replace the files in content/tilesets/ by hand.",
      });
    }
    return this.fetchFrom(remote, id, version);
  }

  /** Tries each source in order; the first that actually has the tileset wins. */
  async fetchTileset(id: string, version?: string): Promise<{ tsj: TilesetJson; images: ImageBlob[] }> {
    return this.fetchFrom(this.sources, id, version);
  }

  private async fetchFrom(
    sources: NamedRepository[],
    id: string,
    version?: string,
  ): Promise<{ tsj: TilesetJson; images: ImageBlob[] }> {
    let lastError: unknown;
    for (const { repository } of sources) {
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

  // --- selection handshake --------------------------------------------------
  //
  // Delegated to the first source that can host one. The local catalog never
  // can — there is no page to send anyone to — so this is effectively "the first
  // configured API".

  private selectionHost(): AssetRepository {
    const source = this.sources.find((entry) => typeof entry.repository.createSelection === "function");
    if (!source) {
      throw new MapMcpError("INVALID_ARGUMENT", "No configured asset source can host a browser selection", {
        rule: "no-selection-source",
        fix: "Configure ASSET_APIS with an asset API that serves /selections, or pick an asset by id instead.",
      });
    }
    return source.repository;
  }

  async createSelection(input: CreateSelectionInput): Promise<SelectionSession> {
    return this.selectionHost().createSelection!(input);
  }

  async readSelection(token: string): Promise<SelectionSession> {
    return this.selectionHost().readSelection!(token);
  }

  async cancelSelection(token: string): Promise<SelectionSession> {
    return this.selectionHost().cancelSelection!(token);
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
