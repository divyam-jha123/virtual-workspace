import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Drives the server the way a real client does: a separate process, over stdio.
 *
 * By default it runs the built `dist/index.js`. Point MAP_MCP_SMOKE_CMD at the
 * container to run the exact same assertions against the image:
 *
 *   MAP_MCP_SMOKE_CMD='docker run --rm -i -v /tmp/ws:/workspace \
 *     -e MAP_MCP_WORKSPACE=/workspace vorkium/map-mcp:dev' \
 *   MAP_MCP_SMOKE_WORKSPACE=/tmp/ws pnpm --filter map-mcp test
 *
 * MAP_MCP_SMOKE_WORKSPACE is the HOST side of that mount: inside the container the
 * workspace is /workspace, but the filesystem assertions below run out here, so
 * they need the path the volume actually lives at.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "index.js");
const built = await fs
  .stat(entry)
  .then(() => true)
  .catch(() => false);

const external = process.env.MAP_MCP_SMOKE_CMD;
const runnable = built || Boolean(external);

describe.skipIf(!runnable)("stdio transport", () => {
  let client: Client;
  let root: string;

  beforeAll(async () => {
    root = process.env.MAP_MCP_SMOKE_WORKSPACE ?? path.join(await fs.mkdtemp(path.join(os.tmpdir(), "map-mcp-stdio-")), "content");
    await fs.mkdir(root, { recursive: true });

    const [command, ...args] = external ? external.split(/\s+/) : [process.execPath, entry];
    client = new Client({ name: "smoke-test", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: command!,
        args,
        env: { ...(process.env as Record<string, string>), MAP_MCP_WORKSPACE: root },
        stderr: "ignore",
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    // Only clean up the temp workspace this test made; never an external mount.
    if (root && !process.env.MAP_MCP_SMOKE_WORKSPACE) await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("completes the handshake and reports its identity", () => {
    expect(client.getServerVersion()).toMatchObject({ name: "map-mcp" });
  });

  it("lists its tools over the wire", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("get_project_info");
    expect(names).toContain("save_map");
  });

  it("answers get_project_info", async () => {
    const result = (await client.callTool({ name: "get_project_info", arguments: {} })) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.tileSize).toBe(16);
  });

  it("creates the workspace layout on first run", async () => {
    const entries = new Set(await fs.readdir(root));
    for (const dir of [".map-mcp", "assets", "maps", "runtime", "schemas", "tilesets"]) expect(entries).toContain(dir);
  });

  it("round-trips a full authoring flow and writes the file", async () => {
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
      return JSON.parse(result.content[0]!.text);
    };
    const mapId = `maps/smoke-${Date.now()}.tmj`;
    expect((await call("create_map", { mapId, width: 8, height: 8, name: "Smoke" })).ok).toBe(true);
    expect((await call("add_object", { mapId, class: "spawn", x: 1, y: 1, properties: { id: "main", default: true } })).ok).toBe(true);
    expect((await call("save_map", { mapId })).ok).toBe(true);

    const written = JSON.parse(await fs.readFile(path.join(root, mapId), "utf8"));
    expect(written.type).toBe("map");
    expect(written.width).toBe(8);
  });
});
