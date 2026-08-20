import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./helpers/harness.js";

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  await h.close();
});

describe("discovery", () => {
  it("advertises every V1 tool", async () => {
    const names = (await h.client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "add_layer", "add_object", "add_tileset", "create_map", "get_asset", "get_project_info",
      "list_tilesets", "move_object", "place_asset", "place_tiles", "read_map", "remove_object",
      "save_map", "search_assets", "set_property", "validate_map",
    ]);
  });

  it("advertises the project resources", async () => {
    const uris = (await h.client.listResources()).resources.map((resource) => resource.uri).sort();
    expect(uris).toEqual(["assets://tilesets", "map://schema", "project://config", "project://conventions"]);
  });

  it("serves project://conventions with the layer stack and object classes", async () => {
    const result = await h.client.readResource({ uri: "project://conventions" });
    const conventions = JSON.parse(String(result.contents[0]!.text));
    expect(conventions.tileSize).toBe(32);
    expect(conventions.layerOrder[0]).toBe("Ground");
    expect(conventions.objectClasses.spawn.properties.default.required).toBe(true);
  });
});

describe("get_project_info", () => {
  it("reports conventions, maps, and asset-source status", async () => {
    const info = await h.call("get_project_info");
    expect(info.ok).toBe(true);
    expect(info.tileSize).toBe(32);
    expect(info.maps).toEqual([]);
    expect(info.assetSource).toMatchObject({ source: "local", reachable: true, vendoredTilesets: 3 });
    expect(info.conventions.objectClasses["interaction-zone"].properties.kind.enum).toContain("audio-private");
  });
});

describe("assets", () => {
  it("searches, and filters out art drawn for another tile size", async () => {
    const result = await h.call("search_assets", { query: "desk" });
    expect(result.assets.map((a: { id: string }) => a.id)).toContain("office.desk.pod4");
    // retro.desk.small is a 16px asset: unplaceable here, so it is not offered.
    expect(result.assets.map((a: { id: string }) => a.id)).not.toContain("retro.desk.small");
  });

  it("returns a fix hint instead of an empty silence", async () => {
    const result = await h.call("search_assets", { query: "spaceship" });
    expect(result.count).toBe(0);
    expect(result.hint).toBeTruthy();
  });

  it("fails a bad asset id with a code and a fix", async () => {
    const result = await h.call("get_asset", { assetId: "nope" });
    expect(result).toMatchObject({ ok: false, code: "ASSET_NOT_FOUND", isError: true });
    expect(result.diagnostics[0].fix).toMatch(/search_assets/);
  });
});

describe("authoring flow", () => {
  async function buildValidMap(mapId = "maps/hq.tmj") {
    await h.call("create_map", { mapId, width: 12, height: 10, name: "HQ" });
    await h.call("add_tileset", { mapId, tilesetId: "office-core" });
    await h.call("place_tiles", { mapId, layer: "Ground", x: 0, y: 0, width: 12, height: 10, gid: 1 });
    await h.call("add_object", { mapId, class: "spawn", x: 1, y: 1, properties: { id: "main", default: true } });
    return mapId;
  }

  it("creates -> places -> validates -> saves, and the file lands on disk", async () => {
    const mapId = await buildValidMap();
    const placed = await h.call("place_asset", { mapId, assetId: "office.desk.pod4", x: 4, y: 4 });
    expect(placed.ok).toBe(true);
    expect(placed.validation.ok).toBe(true);

    const saved = await h.call("save_map", { mapId });
    expect(saved.ok).toBe(true);

    const onDisk = await h.workspace.readJson<Record<string, any>>(mapId);
    expect(onDisk.type).toBe("map");
    expect(onDisk.infinite).toBe(false);
    expect(onDisk.tilesets).toEqual([{ firstgid: 1, source: "../tilesets/office-core.tsj" }]);
    expect(onDisk.layers.find((l: any) => l.name === "Ground").data).toHaveLength(120);
  });

  it("place_asset marks the collision footprint of a blocking asset", async () => {
    const mapId = await buildValidMap();
    await h.call("place_asset", { mapId, assetId: "office.desk.pod4", x: 4, y: 4 });
    await h.call("save_map", { mapId });

    const onDisk = await h.workspace.readJson<any>(mapId);
    const collision = onDisk.layers.find((l: any) => l.name === "Collision").data;
    expect(collision[4 * 12 + 4]).toBe(1);
    expect(collision[6 * 12 + 7]).toBe(1);
    expect(collision[0]).toBe(0);
  });

  it("place_asset carries interaction metadata onto the object", async () => {
    const mapId = await buildValidMap();
    const placed = await h.call("place_asset", { mapId, assetId: "office.desk.pod4", x: 4, y: 4 });
    const map = await h.call("read_map", { mapId });
    const object = map.map.objects.find((o: any) => o.id === placed.objectId);
    expect(object).toMatchObject({ class: "workstation", tile: { x: 4, y: 4 }, size: { width: 4, height: 3 } });
    expect(object.properties.capacity).toBe(4);
  });

  it("read_map gives a semantic view, not raw JSON", async () => {
    const mapId = await buildValidMap();
    const result = await h.call("read_map", { mapId });
    expect(result.map).toMatchObject({ id: mapId, name: "HQ", width: 12, height: 10, tileSize: 32, draft: true });
    expect(result.map.layers.find((l: any) => l.name === "Ground")).toMatchObject({ tiles: 120 });
    expect(result.map.objects[0]).toMatchObject({ class: "spawn", tile: { x: 1, y: 1 } });
  });

  it("moves and removes objects", async () => {
    const mapId = await buildValidMap();
    const added = await h.call("add_object", { mapId, class: "door", x: 2, y: 2, properties: { locked: false } });
    await h.call("move_object", { mapId, objectId: added.objectId, x: 7, y: 8 });
    let map = await h.call("read_map", { mapId });
    expect(map.map.objects.find((o: any) => o.id === added.objectId).tile).toEqual({ x: 7, y: 8 });

    await h.call("remove_object", { mapId, objectId: added.objectId });
    map = await h.call("read_map", { mapId });
    expect(map.map.objects.find((o: any) => o.id === added.objectId)).toBeUndefined();
  });

  it("sets properties on objects, layers and the map", async () => {
    const mapId = await buildValidMap();
    await h.call("set_property", { mapId, name: "description", value: "Head office" });
    await h.call("set_property", { mapId, name: "objectId", value: 1, layer: "Ground" });
    const map = await h.call("read_map", { mapId });
    expect(map.map.properties.description).toBe("Head office");
  });
});

describe("save gating", () => {
  it("refuses to save a map with errors and writes nothing", async () => {
    const mapId = "maps/broken.tmj";
    await h.call("create_map", { mapId, width: 6, height: 6 });
    const result = await h.call("save_map", { mapId });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED", isError: true });
    expect(result.diagnostics.some((d: any) => d.rule === "spawn-missing")).toBe(true);
    expect(result.diagnostics.some((d: any) => d.rule === "save-blocked")).toBe(true);
    expect(await h.workspace.exists(mapId)).toBe(false);
  });

  it("saves once the errors are fixed", async () => {
    const mapId = "maps/fixable.tmj";
    await h.call("create_map", { mapId, width: 6, height: 6 });
    await h.call("add_object", { mapId, class: "spawn", x: 1, y: 1, properties: { id: "main", default: true } });
    expect((await h.call("save_map", { mapId })).ok).toBe(true);
    expect(await h.workspace.exists(mapId)).toBe(true);
  });

  it("does not overwrite an existing map unless asked", async () => {
    const mapId = "maps/existing.tmj";
    await h.call("create_map", { mapId, width: 6, height: 6 });
    await h.call("add_object", { mapId, class: "spawn", x: 1, y: 1, properties: { id: "main", default: true } });
    await h.call("save_map", { mapId });

    const blocked = await h.call("create_map", { mapId, width: 8, height: 8 });
    expect(blocked).toMatchObject({ ok: false, code: "ALREADY_EXISTS" });
    expect((await h.call("create_map", { mapId, width: 8, height: 8, overwrite: true })).ok).toBe(true);
  });
});

describe("error envelopes", () => {
  it("rejects a path outside maps/ with a fix hint", async () => {
    const result = await h.call("read_map", { mapId: "../../etc/passwd" });
    expect(result).toMatchObject({ ok: false, isError: true });
    expect(result.diagnostics[0].fix).toBeTruthy();
  });

  it("names the existing layers when one is missing", async () => {
    await h.call("create_map", { mapId: "maps/x.tmj", width: 4, height: 4 });
    const result = await h.call("place_tiles", { mapId: "maps/x.tmj", layer: "Nope", x: 0, y: 0, width: 1, height: 1, gid: 1 });
    expect(result.code).toBe("NOT_FOUND");
    expect(result.diagnostics[0].fix).toMatch(/Ground/);
  });

  it("refuses a tileset that is not vendored, and says why", async () => {
    await h.call("create_map", { mapId: "maps/x.tmj", width: 4, height: 4 });
    const result = await h.call("add_tileset", { mapId: "maps/x.tmj", tilesetId: "does-not-exist" });
    expect(result.code).toBe("ASSET_NOT_FOUND");
    expect(result.diagnostics[0].fix).toMatch(/Tiled cannot open it/);
  });

  it("refuses an out-of-bounds tile region", async () => {
    await h.call("create_map", { mapId: "maps/x.tmj", width: 4, height: 4 });
    const result = await h.call("place_tiles", { mapId: "maps/x.tmj", layer: "Ground", x: 3, y: 3, width: 5, height: 5, gid: 1 });
    expect(result.code).toBe("INVALID_ARGUMENT");
  });
});
