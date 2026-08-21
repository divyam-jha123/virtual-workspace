import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAssetRepository } from "../src/services/assets/local-repository.js";
import type { AssetRepository } from "../src/services/assets/types.js";
import { WorkspaceService } from "../src/services/workspace.js";
import { TILE_SIZE } from "../src/schema/index.js";
import { CATALOG } from "./helpers/fixtures.js";

/**
 * The AssetRepository contract, exercised against the filesystem-backed catalog.
 */
async function create(root: string): Promise<AssetRepository> {
  const workspace = new WorkspaceService(root);
  await workspace.ensureLayout();
  await workspace.writeJson("assets/catalog.json", { assets: CATALOG });
  return new LocalAssetRepository(workspace, { tileSize: TILE_SIZE });
}

describe("LocalAssetRepository — AssetRepository contract", () => {
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
      tileSize: TILE_SIZE,
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
    const results = await repo.search({ query: "desk", tileSize: TILE_SIZE });
    expect(results.map((r) => r.id)).toContain("office.desk.pod4");
    expect(results.every((r) => r.tileSize === TILE_SIZE)).toBe(true);
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
