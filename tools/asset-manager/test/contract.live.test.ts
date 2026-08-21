import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpAssetRepository } from "../../map-mcp/src/services/assets/http-repository.js";
import { TILE_SIZE } from "../../map-mcp/src/schema/index.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { createServer } from "../src/server.js";
import { seedFixtureCatalog } from "./helpers/fixture-seed.js";

/**
 * The map-mcp AssetRepository contract, run against a LIVE Asset Manager over real
 * HTTP — same assertions as tools/map-mcp/test/asset-repository.contract.test.ts.
 * If a behaviour is not identical here, the Asset Manager is not a drop-in source.
 */
describe("HttpAssetRepository against a live Asset Manager", () => {
  let prisma: PrismaClient;
  let server: Server;
  let repo: HttpAssetRepository;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await seedFixtureCatalog(prisma);

    const config = loadConfig({ ...process.env, ASSET_MANAGER_API_KEY: "test-key" });
    const app = createServer(createContext(config, prisma));
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;

    repo = new HttpAssetRepository({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
      defaults: { tileSize: TILE_SIZE },
      sleep: async () => {},
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
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

  it("finds assets by free text and only for the requested tile size", async () => {
    const results = await repo.search({ query: "desk", tileSize: TILE_SIZE });
    expect(results.map((r) => r.id)).toContain("office.desk.pod4");
    expect(results.every((r) => r.tileSize === TILE_SIZE)).toBe(true);
  });

  it("ranks the closest match first", async () => {
    const results = await repo.search({ query: "chair" });
    expect(results[0]?.id).toBe("office.chair.swivel");
  });

  it("expands synonyms (table -> desk)", async () => {
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
