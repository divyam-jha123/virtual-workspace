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
 * The client half of vendoring: art the workspace does not have is pulled from
 * the asset source instead of failing. This is what removes the manual "vendor"
 * step — the map tool fetches what a placement needs, when it needs it.
 */

const REMOTE_TSJ = { ...OFFICE_CORE_TSJ, name: "vendor-props", image: "vendor-props.png" };

const REMOTE_ASSET = {
  id: "vendor.chair",
  name: "Vendor chair",
  category: "furniture",
  tags: ["chair", "seat"],
  tileSize: 16,
  dimensions: { width: 1, height: 1 },
  placement: "floor",
  tilesetId: "vendor-props",
  tileId: 4,
};

/** Routes by origin+pathname; serves JSON or PNG depending on the route table. */
function routeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body = routes[`${url.origin}${url.pathname}`];
    if (body === undefined) return new Response("", { status: 404 });
    if (body instanceof Uint8Array) {
      return new Response(body, { status: 200, headers: { "content-type": "image/png" } });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

/**
 * A collection tileset: per-tile images rather than one atlas. This is the shape
 * real props use (office-props), and the only shape a per-tile preview exists for.
 */
const REMOTE_COLLECTION_TSJ = {
  name: "vendor-collection",
  type: "tileset",
  tilewidth: 16,
  tileheight: 16,
  columns: 0,
  tilecount: 2,
  margin: 0,
  spacing: 0,
  grid: { orientation: "orthogonal", width: 1, height: 1 },
  tiles: [
    { id: 0, image: "vendor-stool.png", imagewidth: 16, imageheight: 16 },
    { id: 1, image: "vendor-sofa.png", imagewidth: 32, imageheight: 16 },
  ],
};

const COLLECTION_ASSET = {
  id: "vendor.sofa",
  name: "Vendor sofa",
  category: "furniture",
  tags: ["sofa", "seat"],
  tileSize: 16,
  dimensions: { width: 2, height: 1 },
  placement: "floor",
  tilesetId: "vendor-collection",
  tileId: 1,
};

const REMOTE_ROUTES: Record<string, unknown> = {
  "https://vendor.example.com/v1/assets": { items: [REMOTE_ASSET, COLLECTION_ASSET] },
  "https://vendor.example.com/v1/assets/vendor.chair": { asset: REMOTE_ASSET },
  "https://vendor.example.com/v1/assets/vendor.sofa": { asset: COLLECTION_ASSET },
  "https://vendor.example.com/v1/tilesets": {
    items: [{ id: "vendor-props", tileSize: 16 }, { id: "vendor-collection", tileSize: 16 }],
  },
  "https://vendor.example.com/v1/tilesets/vendor-props.tsj": REMOTE_TSJ,
  "https://vendor.example.com/v1/tilesets/vendor-props/vendor-props.png": PNG_STUB,
  "https://vendor.example.com/v1/tilesets/vendor-collection.tsj": REMOTE_COLLECTION_TSJ,
  "https://vendor.example.com/v1/tilesets/vendor-collection/vendor-stool.png": PNG_STUB,
  "https://vendor.example.com/v1/tilesets/vendor-collection/vendor-sofa.png": PNG_STUB,
};

async function connect(root: string) {
  const config = loadConfig({
    MAP_MCP_WORKSPACE: root,
    ASSET_APIS: JSON.stringify([{ name: "vendor", url: "https://vendor.example.com/v1" }]),
  } as NodeJS.ProcessEnv);

  const { server } = await createServer(config);
  const client = new Client({ name: "sync-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const callRaw = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    };
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse((await callRaw(name, args)).content[0]!.text!);
  return { server, client, call, callRaw };
}

async function makeWorkspace(prefix: string): Promise<{ base: string; root: string; workspace: WorkspaceService }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const root = path.join(base, "content");
  const workspace = new WorkspaceService(root);
  await workspace.ensureLayout();
  return { base, root, workspace };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sync_tilesets", () => {
  it("pulls a remote tileset and its atlas onto disk", async () => {
    const { base, root, workspace } = await makeWorkspace("map-mcp-sync-");
    vi.stubGlobal("fetch", routeFetch(REMOTE_ROUTES));
    const { server, client, call } = await connect(root);

    // Nothing is vendored yet, so the tileset is known but unusable by Tiled.
    const before = await call("list_tilesets");
    expect(before.tilesets.find((t: any) => t.id === "vendor-props").vendored).toBe(false);

    const result = await call("sync_tilesets");
    expect(result.ok).toBe(true);
    expect(result.synced.map((s: any) => s.id).sort()).toEqual(["vendor-collection", "vendor-props"]);
    expect(result.synced.every((s: any) => s.missingImages.length === 0)).toBe(true);

    // Both halves have to land: a .tsj without its atlas opens blank in Tiled.
    expect(await workspace.exists("tilesets/vendor-props.tsj")).toBe(true);
    expect(await workspace.exists("tilesets/vendor-props.png")).toBe(true);

    const after = await call("list_tilesets");
    expect(after.tilesets.find((t: any) => t.id === "vendor-props").vendored).toBe(true);

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("skips what is already on disk unless forced", async () => {
    const { base, root, workspace } = await makeWorkspace("map-mcp-sync-skip-");
    vi.stubGlobal("fetch", routeFetch(REMOTE_ROUTES));
    const { server, client, call } = await connect(root);

    await call("sync_tilesets");

    // With no ids, targets are already narrowed to what is missing, so an
    // up-to-date workspace has nothing to consider at all — and says so rather
    // than answering with three empty lists.
    const second = await call("sync_tilesets");
    expect(second.synced).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(second.hint).toContain("already on disk");

    // Naming an id that is already present is what reports a skip.
    const named = await call("sync_tilesets", { tilesetIds: ["vendor-props"] });
    expect(named.skipped.map((s: any) => s.id)).toEqual(["vendor-props"]);

    // Force re-fetches over the top, which is how stale art gets refreshed.
    await workspace.writeJson("tilesets/vendor-props.tsj", { stale: true });
    const forced = await call("sync_tilesets", { tilesetIds: ["vendor-props"], force: true });
    expect(forced.synced.map((s: any) => s.id)).toEqual(["vendor-props"]);
    expect(await workspace.readJson("tilesets/vendor-props.tsj")).toMatchObject({ name: "vendor-props" });

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("place_asset fetches missing art on its own instead of failing", async () => {
    const { base, root, workspace } = await makeWorkspace("map-mcp-sync-place-");
    vi.stubGlobal("fetch", routeFetch(REMOTE_ROUTES));
    const { server, client, call } = await connect(root);

    await call("create_map", { mapId: "maps/sync.tmj", width: 16, height: 16 });

    // The headline behaviour: the art for this asset is not on disk, and nobody
    // ran a sync step first. Placing it is what triggers the fetch.
    expect(await workspace.exists("tilesets/vendor-props.tsj")).toBe(false);
    const placed = await call("place_asset", { mapId: "maps/sync.tmj", assetId: "vendor.chair", x: 2, y: 3 });
    expect(placed.ok).toBe(true);
    expect(await workspace.exists("tilesets/vendor-props.tsj")).toBe(true);
    expect(await workspace.exists("tilesets/vendor-props.png")).toBe(true);

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("shows sprite art with search results when asked", async () => {
    const { base, root } = await makeWorkspace("map-mcp-preview-");
    vi.stubGlobal("fetch", routeFetch(REMOTE_ROUTES));
    const { server, client, call, callRaw } = await connect(root);

    // Without showArt the answer stays text-only, so ordinary searches stay cheap.
    const plain = await callRaw("search_assets", { query: "sofa" });
    expect(plain.content.every((block) => block.type === "text")).toBe(true);

    const raw = await callRaw("search_assets", { query: "sofa", showArt: true });
    const images = raw.content.filter((block) => block.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0]!.mimeType).toBe("image/png");
    // Real PNG bytes, base64-encoded — not a path or a URL.
    expect(Buffer.from(images[0]!.data!, "base64").subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // The images are a flat list, so the envelope has to name what they are.
    const body = JSON.parse(raw.content[0]!.text!);
    expect(body.artShownFor).toEqual(["vendor.sofa"]);

    // Previewing pulls the tileset down, which is exactly what placing it needs.
    const tilesets = await call("list_tilesets");
    expect(tilesets.tilesets.find((t: any) => t.id === "vendor-collection").vendored).toBe(true);

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("still answers when art cannot be shown for a result", async () => {
    const { base, root } = await makeWorkspace("map-mcp-preview-grid-");
    vi.stubGlobal("fetch", routeFetch(REMOTE_ROUTES));
    const { server, client, callRaw } = await connect(root);

    // vendor.chair lives in a grid atlas, which has no per-tile image. That must
    // degrade to "no picture" rather than failing the whole search.
    const raw = await callRaw("search_assets", { query: "chair", showArt: true });
    const body = JSON.parse(raw.content[0]!.text!);

    expect(body.ok).toBe(true);
    expect(body.assets.map((a: any) => a.id)).toContain("vendor.chair");
    expect(body.artShownFor).not.toContain("vendor.chair");
    expect(body.artUnavailableFor).toContain("vendor.chair");

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("reports a clear error when the source cannot supply the tileset", async () => {
    const { base, root } = await makeWorkspace("map-mcp-sync-fail-");
    // The catalog answers, but the tileset endpoint does not — a broken library,
    // which must not look like a map-authoring mistake.
    const { ["https://vendor.example.com/v1/tilesets/vendor-props.tsj"]: _dropped, ...partial } = REMOTE_ROUTES;
    vi.stubGlobal("fetch", routeFetch(partial));
    const { server, client, call } = await connect(root);

    await call("create_map", { mapId: "maps/broken.tmj", width: 8, height: 8 });
    const failed = await call("place_asset", { mapId: "maps/broken.tmj", assetId: "vendor.chair", x: 1, y: 1 });

    expect(failed.ok).toBe(false);
    expect(failed.code).toBe("ASSET_NOT_FOUND");
    expect(failed.diagnostics[0].rule).toBe("tileset-not-vendored");
    expect(failed.diagnostics[0].fix).toContain("Fetching it failed");

    const report = await call("sync_tilesets", { tilesetIds: ["vendor-props"] });
    expect(report.synced).toEqual([]);
    expect(report.failed.map((f: any) => f.id)).toEqual(["vendor-props"]);

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });
});
