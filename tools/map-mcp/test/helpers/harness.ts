import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { createServer } from "../../src/server.js";
import type { MapService } from "../../src/services/map-service.js";
import { WorkspaceService } from "../../src/services/workspace.js";
import { CATALOG } from "./fixtures.js";

export interface Harness {
  client: Client;
  root: string;
  workspace: WorkspaceService;
  /** The server's own MapService, for tests that need to force a reload from disk. */
  maps: MapService;
  call: (name: string, args?: Record<string, unknown>) => Promise<any>;
  close: () => Promise<void>;
}

/** Enough of a PNG to stand in for an atlas on disk. */
export const PNG_STUB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A tileset that exists as a real file, so maps can legitimately reference it. */
export const OFFICE_CORE_TSJ = {
  columns: 8,
  image: "office-core.png",
  imageheight: 256,
  imagewidth: 256,
  margin: 0,
  name: "office-core",
  spacing: 0,
  tilecount: 64,
  tiledversion: "1.11.0",
  tileheight: 16,
  tilewidth: 16,
  type: "tileset",
  version: "1.10",
};

/** An in-process MCP client talking to the real server over an in-memory transport. */
export async function startHarness(options: { catalog?: unknown; tilesets?: string[] } = {}): Promise<Harness> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "map-mcp-e2e-"));
  const root = path.join(base, "content");

  const workspace = new WorkspaceService(root);
  await workspace.ensureLayout();
  await workspace.writeJson("assets/catalog.json", { assets: options.catalog ?? CATALOG });
  for (const id of options.tilesets ?? ["office-core", "decor-pack", "retro-pack"]) {
    await workspace.writeJson(`tilesets/${id}.tsj`, { ...OFFICE_CORE_TSJ, name: id, image: `${id}.png` });
    // The atlas image has to exist too — a .tsj pointing at a missing PNG is an
    // error, because the map would open blank in Tiled.
    await workspace.writeBytes(`tilesets/${id}.png`, PNG_STUB);
  }

  const config = loadConfig({ MAP_MCP_WORKSPACE: root } as NodeJS.ProcessEnv);
  const { server, context } = await createServer(config);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    root,
    workspace,
    maps: context.maps,
    async call(name, args = {}) {
      const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
      const payload = JSON.parse(result.content[0]!.text);
      return { ...payload, isError: result.isError === true };
    },
    async close() {
      await client.close();
      await server.close();
      await fs.rm(base, { recursive: true, force: true });
    },
  };
}
