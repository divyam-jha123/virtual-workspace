import { describe, expect, it } from "vitest";
import { CompositeAssetRepository } from "../src/services/assets/composite-repository.js";
import type { AssetRepository, AssetRecord, TilesetJson } from "../src/services/assets/types.js";

function stubRepo(overrides: Partial<AssetRepository> & { kind?: AssetRepository["kind"] } = {}): AssetRepository {
  return {
    kind: "api",
    get: async () => null,
    search: async () => [],
    listTilesets: async () => [],
    fetchTileset: async () => {
      throw new Error("not found");
    },
    health: async () => ({ reachable: true }),
    ...overrides,
  };
}

function record(id: string, extra: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id,
    name: id,
    category: "furniture",
    tags: [],
    tileSize: 32,
    dimensions: { width: 1, height: 1 },
    placement: "floor",
    tilesetId: "office-core",
    tileId: 1,
    ...extra,
  };
}

describe("collision precedence — first-listed source wins", () => {
  it("get() returns the earlier source's record for a shared id", async () => {
    const local = record("office.desk.pod4", { name: "My local desk" });
    const vendorA = record("office.desk.pod4", { name: "Vendor A standing desk", tilesetId: "vendorA-modern", tileId: 7 });

    const composite = new CompositeAssetRepository([
      { name: "local", repository: stubRepo({ kind: "local", get: async (id) => (id === local.id ? local : null) }) },
      { name: "vendorA", repository: stubRepo({ get: async (id) => (id === vendorA.id ? vendorA : null) }) },
    ]);

    await expect(composite.get("office.desk.pod4")).resolves.toEqual(local);
  });

  it("falls through to a later source when the earlier one does not have the id", async () => {
    const vendorA = record("vendorA.only");
    const composite = new CompositeAssetRepository([
      { name: "local", repository: stubRepo({ kind: "local", get: async () => null }) },
      { name: "vendorA", repository: stubRepo({ get: async (id) => (id === vendorA.id ? vendorA : null) }) },
    ]);
    await expect(composite.get("vendorA.only")).resolves.toEqual(vendorA);
  });

  it("search() de-dupes a shared id, keeping the earlier source's copy", async () => {
    const local = record("office.desk.pod4", { name: "My local desk" });
    const vendorA = record("office.desk.pod4", { name: "Vendor A standing desk" });

    const composite = new CompositeAssetRepository([
      { name: "local", repository: stubRepo({ kind: "local", search: async () => [local] }) },
      { name: "vendorA", repository: stubRepo({ search: async () => [vendorA] }) },
    ]);

    const results = await composite.search({ query: "desk" });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("My local desk");
  });

  it("merges non-overlapping results from both sources", async () => {
    const composite = new CompositeAssetRepository([
      { name: "local", repository: stubRepo({ kind: "local", search: async () => [record("local.chair")] }) },
      { name: "vendorA", repository: stubRepo({ search: async () => [record("vendorA.plant")] }) },
    ]);
    const results = await composite.search({});
    expect(results.map((r) => r.id).sort()).toEqual(["local.chair", "vendorA.plant"]);
  });
});

describe("partial failure", () => {
  it("search still returns the working source's results when another throws", async () => {
    const composite = new CompositeAssetRepository([
      { name: "local", repository: stubRepo({ kind: "local", search: async () => [record("local.chair")] }) },
      {
        name: "vendorA",
        repository: stubRepo({
          search: async () => {
            throw new Error("503");
          },
        }),
      },
    ]);
    await expect(composite.search({})).resolves.toEqual([expect.objectContaining({ id: "local.chair" })]);
  });

  it("health is reachable overall as long as one source is, and reports each by name", async () => {
    const composite = new CompositeAssetRepository([
      { name: "local", repository: stubRepo({ kind: "local", health: async () => ({ reachable: true, detail: "3 assets" }) }) },
      { name: "vendorA", repository: stubRepo({ health: async () => ({ reachable: false, detail: "401" }) }) },
    ]);
    const health = await composite.health();
    expect(health.reachable).toBe(true);
    expect(health.detail).toContain("local: reachable");
    expect(health.detail).toContain("vendorA: unreachable");
  });

  it("health is unreachable only when every source is down", async () => {
    const composite = new CompositeAssetRepository([
      { name: "local", repository: stubRepo({ kind: "local", health: async () => ({ reachable: false }) }) },
      { name: "vendorA", repository: stubRepo({ health: async () => ({ reachable: false }) }) },
    ]);
    await expect(composite.health()).resolves.toMatchObject({ reachable: false });
  });

  it("listTilesets skips a source that throws rather than failing the whole call", async () => {
    const composite = new CompositeAssetRepository([
      { name: "local", repository: stubRepo({ kind: "local", listTilesets: async () => [{ id: "office-core", vendored: true }] }) },
      {
        name: "vendorA",
        repository: stubRepo({
          listTilesets: async () => {
            throw new Error("unreachable");
          },
        }),
      },
    ]);
    await expect(composite.listTilesets()).resolves.toEqual([{ id: "office-core", vendored: true }]);
  });
});

describe("fetchTileset", () => {
  it("resolves via whichever source actually has the tileset", async () => {
    const payload: { tsj: TilesetJson; images: never[] } = { tsj: { name: "vendorA-modern" }, images: [] };
    const composite = new CompositeAssetRepository([
      {
        name: "local",
        repository: stubRepo({
          kind: "local",
          fetchTileset: async () => {
            throw new Error("not vendored");
          },
        }),
      },
      { name: "vendorA", repository: stubRepo({ fetchTileset: async () => payload }) },
    ]);
    await expect(composite.fetchTileset("vendorA-modern")).resolves.toEqual(payload);
  });

  it("throws when no source has it", async () => {
    const composite = new CompositeAssetRepository([{ name: "local", repository: stubRepo({ kind: "local" }) }]);
    await expect(composite.fetchTileset("nope")).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  });
});

describe("construction", () => {
  it("refuses an empty source list", () => {
    expect(() => new CompositeAssetRepository([])).toThrow(/at least one source/);
  });

  it("refuses duplicate source names", () => {
    expect(
      () =>
        new CompositeAssetRepository([
          { name: "vendorA", repository: stubRepo() },
          { name: "vendorA", repository: stubRepo() },
        ]),
    ).toThrow(/Duplicate asset source/);
  });
});
