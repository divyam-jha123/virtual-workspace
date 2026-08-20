import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEmptyMap, parseTmj, serializeTmj, tilesetIdFromSource } from "../src/services/tiled-adapter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "office-sample.tmj");
const fixture = () => JSON.parse(fs.readFileSync(fixturePath, "utf8"));

describe("parseTmj — a real Tiled-authored file", () => {
  it("reads dimensions, tilesets and the layer stack", () => {
    const model = parseTmj(fixture());
    expect(model).toMatchObject({ width: 8, height: 6, tileWidth: 32, tileHeight: 32, infinite: false });
    expect(model.layers.map((l) => l.name)).toEqual(["Ground", "Walls", "Furniture", "Collision", "SpawnPoints", "InteractionZones"]);
    expect(model.tilesets).toEqual([
      { firstgid: 1, source: "../tilesets/office-core.tsj", id: "office-core", tileCount: 0 },
    ]);
    expect(model.properties.name).toBe("Sample Office");
  });

  it("reads objects with their class, geometry and typed properties", () => {
    const model = parseTmj(fixture());
    const furniture = model.layers.find((l) => l.name === "Furniture");
    expect(furniture?.kind).toBe("objectgroup");
    const desk = furniture?.kind === "objectgroup" ? furniture.objects[0] : undefined;
    expect(desk).toMatchObject({ id: 1, class: "workstation", gid: 43, x: 64, y: 160, width: 128, height: 96 });
    expect(desk?.properties).toEqual({ capacity: 4 });

    const spawn = model.layers.find((l) => l.name === "SpawnPoints");
    const spawnObject = spawn?.kind === "objectgroup" ? spawn.objects[0] : undefined;
    expect(spawnObject?.properties).toEqual({ default: true, id: "main" });
  });

  it("derives next ids that will not collide with existing ones", () => {
    const model = parseTmj(fixture());
    expect(model.nextLayerId).toBe(7);
    expect(model.nextObjectId).toBe(4);
  });

  it("still reads the pre-1.9 `type` spelling of an object class", () => {
    const raw = fixture();
    const layer = raw.layers.find((l: any) => l.name === "Furniture");
    delete layer.objects[0].class;
    layer.objects[0].type = "workstation";
    const model = parseTmj(raw);
    const furniture = model.layers.find((l) => l.name === "Furniture");
    expect(furniture?.kind === "objectgroup" && furniture.objects[0]?.class).toBe("workstation");
  });
});

describe("round-trip", () => {
  it("parse -> serialize -> parse is stable", () => {
    const first = parseTmj(fixture());
    const second = parseTmj(serializeTmj(first));
    expect(second).toEqual(first);
  });

  it("serializing twice is byte-identical, so a no-op edit is a zero-line diff", () => {
    const model = parseTmj(fixture());
    const once = JSON.stringify(serializeTmj(model), null, 2);
    const twice = JSON.stringify(serializeTmj(parseTmj(JSON.parse(once))), null, 2);
    expect(twice).toBe(once);
  });

  it("writes keys in a stable alphabetical order at every level", () => {
    const serialized = serializeTmj(parseTmj(fixture()));
    expect(Object.keys(serialized)).toEqual([...Object.keys(serialized)].sort());
    const layer = (serialized.layers as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(layer)).toEqual([...Object.keys(layer)].sort());
  });

  it("preserves map keys it does not model", () => {
    const raw = { ...fixture(), backgroundcolor: "#112233" };
    expect(serializeTmj(parseTmj(raw)).backgroundcolor).toBe("#112233");
  });

  it("emits a Tiled-shaped file", () => {
    const serialized = serializeTmj(parseTmj(fixture()));
    expect(serialized).toMatchObject({ type: "map", infinite: false, orientation: "orthogonal", renderorder: "right-down", version: "1.10" });
    expect(serialized.tilesets).toEqual([{ firstgid: 1, source: "../tilesets/office-core.tsj" }]);
  });

  it("drops a property bag entirely rather than writing an empty array", () => {
    const model = createEmptyMap({ width: 2, height: 2 });
    expect(serializeTmj(model).properties).toBeUndefined();
  });
});

describe("malformed input produces clean diagnostics", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["not an object", "hello", /not a JSON object/],
    ["a tileset file", { type: "tileset", width: 1, height: 1 }, /Expected a Tiled map/],
    ["an infinite map", { ...fixture(), infinite: true }, /Infinite maps/],
    ["an isometric map", { ...fixture(), orientation: "isometric" }, /Unsupported orientation/],
    ["a missing width", { ...fixture(), width: undefined }, /"width" is missing/],
    ["an embedded tileset", { ...fixture(), tilesets: [{ firstgid: 1, name: "inline", tiles: [] }] }, /Embedded tilesets/],
  ];

  it.each(cases)("rejects %s with a fix hint", (_label, payload, expected) => {
    const err = (() => {
      try {
        parseTmj(payload);
        return null;
      } catch (e) {
        return e as any;
      }
    })();
    expect(err?.code).toBe("INVALID_MAP");
    expect(err.diagnostics[0].message).toMatch(expected);
    expect(err.diagnostics[0].fix).toBeTruthy();
  });

  it("rejects base64 tile data with the exact Tiled setting to change", () => {
    const raw = fixture();
    raw.layers[0].encoding = "base64";
    raw.layers[0].data = "AAAA";
    const err = (() => {
      try {
        parseTmj(raw);
        return null;
      } catch (e) {
        return e as any;
      }
    })();
    expect(err.diagnostics[0].fix).toMatch(/Tile layer format = CSV/);
  });

  it("rejects a layer whose data length disagrees with its size", () => {
    const raw = fixture();
    raw.layers[0].data = [1, 2, 3];
    expect(() => parseTmj(raw)).toThrow(/has 3 tiles but is 8x6/);
  });

  it("rejects image and group layers, which the runtime cannot load", () => {
    expect(() => parseTmj({ ...fixture(), layers: [{ type: "imagelayer", name: "bg" }] })).toThrow(/image layer/);
    expect(() => parseTmj({ ...fixture(), layers: [{ type: "group", name: "g" }] })).toThrow(/group layer/);
  });
});

describe("createEmptyMap", () => {
  it("lays down the full schema stack with the right layer types", () => {
    const model = createEmptyMap({ width: 4, height: 3, name: "New" });
    expect(model.layers.map((l) => l.name)).toEqual([
      "Ground", "Ground_Details", "Walls", "Furniture", "Decorations",
      "Collision", "Objects", "SpawnPoints", "InteractionZones", "AbovePlayer",
    ]);
    expect(model.layers.find((l) => l.name === "Ground")).toMatchObject({ kind: "tilelayer" });
    expect(model.layers.find((l) => l.name === "Objects")).toMatchObject({ kind: "objectgroup" });
    const ground = model.layers.find((l) => l.name === "Ground");
    expect(ground?.kind === "tilelayer" && ground.data).toHaveLength(12);
  });

  it("refuses an out-of-range size", () => {
    expect(() => createEmptyMap({ width: 0, height: 4 })).toThrow(/out of bounds/);
    expect(() => createEmptyMap({ width: 4, height: 9999 })).toThrow(/out of bounds/);
  });
});

describe("tilesetIdFromSource", () => {
  it("takes the basename without the extension", () => {
    expect(tilesetIdFromSource("../tilesets/office-core.tsj")).toBe("office-core");
    expect(tilesetIdFromSource("tilesets/decor-pack.tsj")).toBe("decor-pack");
  });
});
