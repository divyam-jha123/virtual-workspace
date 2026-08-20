import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MapMcpError } from "../src/errors.js";
import { WorkspaceService } from "../src/services/workspace.js";

let root: string;
let outside: string;
let ws: WorkspaceService;

beforeEach(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "map-mcp-test-"));
  root = path.join(base, "content");
  outside = path.join(base, "outside");
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "secret.json"), '{"secret":true}');
  ws = new WorkspaceService(root);
  await ws.ensureLayout();
});

afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

async function expectRejected(id: string, options?: Parameters<WorkspaceService["resolve"]>[1]) {
  const err = await ws.resolve(id, options).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected "${id}" to be rejected`).toBeInstanceOf(MapMcpError);
  expect((err as MapMcpError).code).toBe("INVALID_PATH");
  // Every rejection must tell the caller how to recover.
  expect((err as MapMcpError).diagnostics[0]?.fix).toBeTruthy();
}

describe("path jail", () => {
  it("accepts plain ids inside known directories", async () => {
    await expect(ws.resolve("maps/hq.tmj")).resolves.toBe(path.join(await fs.realpath(root), "maps/hq.tmj"));
    await expect(ws.resolve("tilesets/office.tsj")).resolves.toBeTruthy();
    await expect(ws.resolve("assets/desk.png")).resolves.toBeTruthy();
    await expect(ws.resolve(".map-mcp/status.json")).resolves.toBeTruthy();
    await expect(ws.resolve("maps/nested/hq.tmj")).resolves.toBeTruthy();
  });

  it("rejects absolute paths", async () => {
    await expectRejected("/etc/passwd");
    await expectRejected("/tmp/maps/hq.tmj");
    await expectRejected("C:/Windows/system.ini");
    await expectRejected(path.join(outside, "secret.json"));
  });

  it("rejects traversal with ..", async () => {
    await expectRejected("../secret.json");
    await expectRejected("maps/../../outside/secret.json");
    await expectRejected("maps/../maps/hq.tmj");
    await expectRejected("maps/sub/../../../outside/secret.json");
    await expectRejected("..");
  });

  it("rejects dot segments, empty segments, backslashes, NUL and ~", async () => {
    await expectRejected("./maps/hq.tmj");
    await expectRejected("maps//hq.tmj");
    await expectRejected("maps/");
    await expectRejected("maps\\hq.tmj");
    await expectRejected("maps/hq.tmj\0.png");
    await expectRejected("~/maps/hq.tmj");
    await expectRejected("");
    await expectRejected("   ");
  });

  it("rejects unknown top-level directories", async () => {
    await expectRejected("secrets/hq.tmj");
    await expectRejected("node_modules/evil.json");
    await expectRejected("hq.tmj");
  });

  it("enforces the extension allowlist", async () => {
    await expectRejected("maps/hq.exe");
    await expectRejected("maps/hq");
    await expectRejected("maps/.env");
    await expectRejected("assets/run.sh");
    await expect(ws.resolve("maps/hq.TMJ")).resolves.toBeTruthy();
  });

  it("restricts writes to the writable directories", async () => {
    await expect(ws.resolve("schemas/map.json")).resolves.toBeTruthy();
    await expectRejected("schemas/map.json", { write: true });
    await expect(ws.resolve("runtime/hq.json", { write: true })).resolves.toBeTruthy();
  });

  it("rejects a symlinked file that escapes the root", async () => {
    await fs.symlink(path.join(outside, "secret.json"), path.join(root, "maps", "leak.json"));
    await expectRejected("maps/leak.json");
  });

  it("rejects a file under a symlinked directory that escapes the root", async () => {
    await fs.symlink(outside, path.join(root, "maps", "link"));
    await expectRejected("maps/link/secret.json");
    // Even a not-yet-existing file behind the link is refused.
    await expectRejected("maps/link/new.tmj");
  });

  it("rejects a symlinked top-level workspace directory", async () => {
    await fs.rm(path.join(root, "runtime"), { recursive: true });
    await fs.symlink(outside, path.join(root, "runtime"));
    await expectRejected("runtime/secret.json");
  });

  it("allows symlinks that stay inside the root", async () => {
    await fs.symlink(path.join(root, "maps"), path.join(root, "runtime", "maps-link"));
    await expect(ws.resolve("runtime/maps-link/hq.tmj")).resolves.toBeTruthy();
  });
});

describe("io", () => {
  it("round-trips json atomically and leaves no tmp files", async () => {
    await ws.writeJson("maps/hq.tmj", { width: 4 });
    expect(await ws.readJson("maps/hq.tmj")).toEqual({ width: 4 });
    const entries = await fs.readdir(path.join(root, "maps"));
    expect(entries).toEqual(["hq.tmj"]);
  });

  it("reports a missing file as NOT_FOUND", async () => {
    await expect(ws.readText("maps/nope.tmj")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports malformed json as INVALID_MAP with a fix hint", async () => {
    await fs.writeFile(path.join(root, "maps", "bad.tmj"), "{not json");
    const err = await ws.readJson("maps/bad.tmj").catch((e: MapMcpError) => e);
    expect((err as MapMcpError).code).toBe("INVALID_MAP");
    expect((err as MapMcpError).diagnostics[0]?.fix).toBeTruthy();
  });

  it("lists a directory as workspace ids, filtered by extension", async () => {
    await ws.writeJson("maps/a.tmj", {});
    await ws.writeJson("maps/b.tmj", {});
    await ws.writeJson("maps/notes.json", {});
    expect(await ws.list("maps", { extensions: [".tmj"] })).toEqual(["maps/a.tmj", "maps/b.tmj"]);
    expect(await ws.list("runtime")).toEqual([]);
  });

  it("refuses to write outside the writable set", async () => {
    await expect(ws.writeJson("schemas/x.json", {})).rejects.toMatchObject({ code: "INVALID_PATH" });
    await expect(ws.writeJson("../escape.json", {})).rejects.toMatchObject({ code: "INVALID_PATH" });
  });
});
