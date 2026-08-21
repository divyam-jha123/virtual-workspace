import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { WorkspaceService } from "../src/services/workspace.js";

/**
 * The browser handshake: the server asks "which of these?", a person answers in
 * a page, and the tool returns the id they clicked.
 *
 * The fake API below keeps real state, so the test exercises the actual polling
 * loop rather than a single canned response.
 */

const ASSETS = [
  { id: "vendor.chair-a", name: "Chair A", category: "furniture", tags: ["chair"], tileSize: 16, dimensions: { width: 1, height: 1 }, placement: "floor", tilesetId: "props", tileId: 1 },
  { id: "vendor.chair-b", name: "Chair B", category: "furniture", tags: ["chair"], tileSize: 16, dimensions: { width: 1, height: 1 }, placement: "floor", tilesetId: "props", tileId: 2 },
];

interface FakeSelection {
  token: string;
  prompt: string;
  status: string;
  candidateIds: string[];
  chosenId: string | null;
  expiresAt: string;
}

/** A stand-in asset API that actually stores selections. */
function fakeApi() {
  const selections = new Map<string, FakeSelection>();
  let counter = 0;

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (url.pathname === "/v1/selections" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { prompt: string; candidateIds: string[] };
      const token = `tok${++counter}`;
      const selection: FakeSelection = {
        token,
        prompt: body.prompt,
        status: "pending",
        candidateIds: body.candidateIds,
        chosenId: null,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      };
      selections.set(token, selection);
      return json({ ...selection, url: `http://ui.test/pick/${token}` }, 201);
    }

    const match = /^\/v1\/selections\/([^/]+)$/.exec(url.pathname);
    if (match && method === "GET") {
      const selection = selections.get(match[1]!);
      if (!selection) return new Response("", { status: 404 });
      return json({ ...selection, url: `http://ui.test/pick/${selection.token}` });
    }

    if (url.pathname === "/v1/assets") return json({ items: ASSETS });
    const asset = /^\/v1\/assets\/(.+)$/.exec(url.pathname);
    if (asset) {
      const found = ASSETS.find((a) => a.id === decodeURIComponent(asset[1]!));
      return found ? json({ asset: found }) : new Response("", { status: 404 });
    }
    if (url.pathname === "/v1/tilesets") return json({ items: [] });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  /** Stand in for a person clicking a card in the browser. */
  const clickInBrowser = (token: string, assetId: string) => {
    const selection = selections.get(token);
    if (selection) Object.assign(selection, { status: "chosen", chosenId: assetId });
  };

  return { impl, clickInBrowser, selections };
}

async function connect(root: string) {
  const config = loadConfig({
    MAP_MCP_WORKSPACE: root,
    ASSET_APIS: JSON.stringify([{ name: "vendor", url: "http://localhost:9/v1" }]),
  } as NodeJS.ProcessEnv);
  const { server } = await createServer(config);
  const client = new Client({ name: "selection-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
    return JSON.parse(result.content[0]!.text);
  };
  return { server, client, call };
}

async function makeRoot(prefix: string): Promise<{ base: string; root: string }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const root = path.join(base, "content");
  await new WorkspaceService(root).ensureLayout();
  return { base, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pick_asset", () => {
  it("returns the id a person clicked", async () => {
    const api = fakeApi();
    vi.stubGlobal("fetch", api.impl);
    const { base, root } = await makeRoot("map-mcp-pick-");
    const { server, client, call } = await connect(root);

    // Answer shortly after the question is asked, as a person would.
    setTimeout(() => api.clickInBrowser("tok1", "vendor.chair-b"), 60);

    const result = await call("pick_asset", {
      prompt: "chair for the meeting room",
      assetIds: ["vendor.chair-a", "vendor.chair-b"],
      waitSeconds: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("chosen");
    expect(result.assetId).toBe("vendor.chair-b");
    // The full record comes back, so place_asset can follow with no extra lookup.
    expect(result.asset).toMatchObject({ id: "vendor.chair-b", name: "Chair B" });

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("hands back a resumable token when nobody answers in time", async () => {
    const api = fakeApi();
    vi.stubGlobal("fetch", api.impl);
    const { base, root } = await makeRoot("map-mcp-pick-wait-");
    const { server, client, call } = await connect(root);

    const waiting = await call("pick_asset", {
      prompt: "a plant",
      assetIds: ["vendor.chair-a"],
      waitSeconds: 0,
    });

    expect(waiting.status).toBe("waiting");
    expect(waiting.token).toBe("tok1");
    expect(waiting.url).toBe("http://ui.test/pick/tok1");
    // Timing out must NOT cancel the question — the link has to stay usable.
    expect(api.selections.get("tok1")!.status).toBe("pending");

    // Resuming with the token picks the same question back up.
    api.clickInBrowser("tok1", "vendor.chair-a");
    const resumed = await call("pick_asset", { prompt: "a plant", token: "tok1", waitSeconds: 5 });
    expect(resumed.status).toBe("chosen");
    expect(resumed.assetId).toBe("vendor.chair-a");

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("refuses to start a selection with no candidates", async () => {
    const api = fakeApi();
    vi.stubGlobal("fetch", api.impl);
    const { base, root } = await makeRoot("map-mcp-pick-empty-");
    const { server, client, call } = await connect(root);

    const result = await call("pick_asset", { prompt: "something" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].fix).toMatch(/search_assets/);

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("explains itself when no source can host a picker", async () => {
    const { base, root } = await makeRoot("map-mcp-pick-local-");
    // Local catalog only: there is no page to send anyone to.
    const config = loadConfig({ MAP_MCP_WORKSPACE: root, ASSET_SOURCE: "local" } as NodeJS.ProcessEnv);
    const { server } = await createServer(config);
    const client = new Client({ name: "selection-local-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const raw = (await client.callTool({
      name: "pick_asset",
      arguments: { prompt: "a chair", assetIds: ["office.chair"] },
    })) as { content: Array<{ text: string }> };
    const result = JSON.parse(raw.content[0]!.text);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].fix).toMatch(/ASSET_APIS/);

    await client.close();
    await server.close();
    await fs.rm(base, { recursive: true, force: true });
  });
});
