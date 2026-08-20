import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpAssetRepository } from "../src/services/assets/http-repository.js";
import { LocalAssetRepository } from "../src/services/assets/local-repository.js";
import type { AssetRepository } from "../src/services/assets/types.js";
import { WorkspaceService } from "../src/services/workspace.js";
import { createFakeAssetApi } from "./helpers/fake-asset-api.js";
import { CATALOG } from "./helpers/fixtures.js";

/**
 * One suite, both implementations. This is what makes the source swappable:
 * if a behaviour is not identical here, it is not behind the seam.
 */
const implementations: Array<{ name: string; create: (root: string) => Promise<AssetRepository> }> = [
  {
    name: "LocalAssetRepository",
    create: async (root) => {
      const workspace = new WorkspaceService(root);
      await workspace.ensureLayout();
      await workspace.writeJson("assets/catalog.json", { assets: CATALOG });
      return new LocalAssetRepository(workspace, { tileSize: 32 });
    },
  },
  {
    name: "HttpAssetRepository",
    create: async () =>
      new HttpAssetRepository({
        baseUrl: "https://assets.example.com/v1",
        apiKey: "test-key",
        defaults: { tileSize: 32 },
        fetchImpl: createFakeAssetApi().fetchImpl,
        sleep: async () => {},
      }),
  },
];

describe.each(implementations)("$name — AssetRepository contract", ({ create }) => {
  let root: string;
  let repo: AssetRepository;

  beforeEach(async () => {
    root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "map-mcp-assets-")), "content");
    repo = await create(root);
  });

  afterEach(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("returns a fully-typed record for a known id", async () => {
    const record = await repo.get("office.desk.pod4");
    expect(record).toMatchObject({
      id: "office.desk.pod4",
      category: "furniture",
      tileSize: 32,
      dimensions: { width: 4, height: 3 },
      placement: "floor",
      tilesetId: "office-core",
      tileId: 42,
    });
    expect(record?.collision?.blocking).toBe(true);
    expect(record?.interaction?.class).toBe("workstation");
  });

  it("returns null for an unknown id rather than throwing", async () => {
    await expect(repo.get("nope.not.here")).resolves.toBeNull();
  });

  it("finds assets by free text", async () => {
    const results = await repo.search({ query: "desk", tileSize: 32 });
    expect(results.map((r) => r.id)).toContain("office.desk.pod4");
    expect(results.every((r) => r.tileSize === 32)).toBe(true);
  });

  it("ranks the closest match first", async () => {
    const results = await repo.search({ query: "chair" });
    expect(results[0]?.id).toBe("office.chair.swivel");
  });

  it("expands synonyms", async () => {
    const results = await repo.search({ query: "table" });
    expect(results.map((r) => r.id)).toContain("office.desk.pod4");
  });

  it("filters by category and style", async () => {
    const decor = await repo.search({ category: "decoration" });
    expect(decor.map((r) => r.id)).toEqual(["decor.plant.fiddle"]);
    const retro = await repo.search({ style: "retro" });
    expect(retro.map((r) => r.id)).toEqual(["retro.desk.small"]);
  });

  it("lists tilesets", async () => {
    const tilesets = await repo.listTilesets();
    expect(tilesets.map((t) => t.id)).toContain("office-core");
  });

  it("reports health without throwing", async () => {
    await expect(repo.health()).resolves.toMatchObject({ reachable: true });
  });
});
