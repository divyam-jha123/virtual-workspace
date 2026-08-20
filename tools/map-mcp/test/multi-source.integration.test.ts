import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { WorkspaceService } from "../src/services/workspace.js";
import { OFFICE_CORE_TSJ, PNG_STUB } from "./helpers/harness.js";

/**
 * End to end through the real server: local catalog + two live vendor APIs,
 * exactly the setup ASSET_APIS is for. Vendor HTTP is faked by stubbing global
 * fetch, since AssetService.fromConfig builds real HttpAssetRepository instances
 * from config — this is what actually exercises that wiring, not just the
 * CompositeAssetRepository unit in isolation.
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** Routes by origin+pathname, ignoring the query string. */
function routeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = `${url.origin}${url.pathname}`;
    return routes[key] === undefined ? new Response("", { status: 404 }) : jsonResponse(routes[key]);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("multiple asset sources, end to end", () => {
  it("merges local + two vendor APIs, with local winning a same-id collision", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "map-mcp-multi-"));
    const root = path.join(base, "content");
    const workspace = new WorkspaceService(root);
    await workspace.ensureLayout();
    await workspace.writeJson("assets/catalog.json", {
      assets: [{ id: "office.desk.pod4", name: "My local desk", category: "furniture", tags: ["desk"], tileSize: 32, dimensions: { width: 4, height: 3 }, placement: "floor", tilesetId: "office-core", tileId: 42 }],
    });
    await workspace.writeJson("tilesets/office-core.tsj", { ...OFFICE_CORE_TSJ, name: "office-core", image: "office-core.png" });
    await workspace.writeBytes("tilesets/office-core.png", PNG_STUB);

    vi.stubGlobal(
      "fetch",
      routeFetch({
        "https://a.example.com/v1/assets": {
          // Same id as the local record — local must still win.
          items: [{ id: "office.desk.pod4", name: "Vendor A standing desk", category: "furniture", tags: ["desk"], tileSize: 32, dimensions: { width: 2, height: 1 }, placement: "floor", tilesetId: "vendorA-modern", tileId: 7 }],
        },
        "https://a.example.com/v1/tilesets": { items: [{ id: "vendorA-modern", tileSize: 32 }] },
        "https://b.example.com/v1/assets": {
          items: [{ id: "vendorB.plant", name: "Vendor B fern", category: "decoration", tags: ["plant"], tileSize: 32, dimensions: { width: 1, height: 1 }, placement: "floor", tilesetId: "vendorB-decor", tileId: 3 }],
        },
        "https://b.example.com/v1/tilesets": { items: [{ id: "vendorB-decor", tileSize: 32 }] },
      }),
    );

    const config = loadConfig({
      MAP_MCP_WORKSPACE: root,
      ASSET_APIS: JSON.stringify([
        { name: "vendorA", url: "https://a.example.com/v1" },
        { name: "vendorB", url: "https://b.example.com/v1" },
      ]),
    } as NodeJS.ProcessEnv);

    const { server } = await createServer(config);
    const client = new Client({ name: "multi-source-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
      return JSON.parse(result.content[0]!.text);
    };

    const info = await call("get_project_info");
    expect(info.assetSource.source).toBe("composite");
    expect(info.assetSource.sources.map((s: any) => s.name).sort()).toEqual(["local", "vendorA", "vendorB"]);
    expect(info.assetSource.sources.every((s: any) => s.reachable)).toBe(true);

    // Collision: local wins over vendorA for the same id.
    const asset = await call("get_asset", { assetId: "office.desk.pod4" });
    expect(asset.asset.name).toBe("My local desk");

    // Merge: a search finds art from every source at once.
    const desks = await call("search_assets", { query: "desk" });
    expect(desks.assets.map((a: any) => a.id)).toContain("office.desk.pod4");
    const plants = await call("search_assets", { query: "plant" });
    expect(plants.assets.map((a: any) => a.id)).toContain("vendorB.plant");

    // Tilesets from every source appear; only the local one is actually vendored,
    // which is the distinction that decides whether Tiled can open a map using it.
    const tilesets = await call("list_tilesets");
    expect(tilesets.tilesets.map((t: any) => t.id).sort()).toEqual(["office-core", "vendorA-modern", "vendorB-decor"]);
    expect(tilesets.tilesets.find((t: any) => t.id === "office-core").vendored).toBe(true);
    expect(tilesets.tilesets.find((t: any) => t.id === "vendorA-modern").vendored).toBe(false);

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("stays usable when a vendor source is unreachable — local still answers", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "map-mcp-multi-degraded-"));
    const root = path.join(base, "content");
    const workspace = new WorkspaceService(root);
    await workspace.ensureLayout();
    await workspace.writeJson("assets/catalog.json", {
      assets: [{ id: "local.chair", name: "Local chair", category: "furniture", tags: ["chair"], tileSize: 16, dimensions: { width: 1, height: 1 }, placement: "floor", tilesetId: "office-core", tileId: 1 }],
    });
    await workspace.writeJson("tilesets/office-core.tsj", { ...OFFICE_CORE_TSJ, name: "office-core", image: "office-core.png" });
    await workspace.writeBytes("tilesets/office-core.png", PNG_STUB);

    vi.stubGlobal(
      "fetch",
      (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
    );

    const config = loadConfig({
      MAP_MCP_WORKSPACE: root,
      ASSET_APIS: JSON.stringify([{ name: "vendorDown", url: "https://down.example.com/v1" }]),
    } as NodeJS.ProcessEnv);

    const { server } = await createServer(config);
    const client = new Client({ name: "degraded-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
      return JSON.parse(result.content[0]!.text);
    };

    const info = await call("get_project_info");
    expect(info.assetSource.reachable).toBe(true); // local keeps it "reachable" overall
    expect(info.assetSource.sources.find((s: any) => s.name === "local").reachable).toBe(true);
    expect(info.assetSource.sources.find((s: any) => s.name === "vendorDown").reachable).toBe(false);

    const chairs = await call("search_assets", { query: "chair" });
    expect(chairs.assets.map((a: any) => a.id)).toEqual(["local.chair"]);

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  }, 20_000);
});
