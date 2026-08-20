import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { MapModel, ObjectLayer, TileLayer } from "../src/model/map-model.js";
import { parseTmj } from "../src/services/tiled-adapter.js";
import { validateMap, type ValidationContext } from "../src/services/validator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = () => JSON.parse(fs.readFileSync(path.join(here, "fixtures", "office-sample.tmj"), "utf8"));

const CONTEXT: ValidationContext = {
  vendoredTilesets: new Set(["office-core"]),
  tileCounts: new Map([["office-core", 64]]),
  tileSizes: new Map([["office-core", 32]]),
};

function goodMap(): MapModel {
  return parseTmj(raw());
}

function rules(model: MapModel, context: ValidationContext = CONTEXT): string[] {
  return validateMap(model, context).diagnostics.map((d) => d.rule);
}

function tileLayer(model: MapModel, name: string): TileLayer {
  return model.layers.find((l) => l.name === name) as TileLayer;
}

function objectLayer(model: MapModel, name: string): ObjectLayer {
  return model.layers.find((l) => l.name === name) as ObjectLayer;
}

describe("the good fixture", () => {
  it("validates clean — no errors, no warnings", () => {
    const result = validateMap(goodMap(), CONTEXT);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Map is valid: no errors, no warnings.");
  });

  it("every diagnostic a rule can emit carries a fix", () => {
    const model = goodMap();
    model.layers = [];
    for (const diagnostic of validateMap(model, CONTEXT).diagnostics) expect(diagnostic.fix).toBeTruthy();
  });
});

describe("structure rules", () => {
  it("layer-missing fires when a required layer is gone", () => {
    const model = goodMap();
    model.layers = model.layers.filter((l) => l.name !== "Collision");
    expect(rules(model)).toContain("layer-missing");
  });

  it("layer-kind fires when a layer has the wrong type", () => {
    const model = goodMap();
    const index = model.layers.findIndex((l) => l.name === "Collision");
    model.layers[index] = { kind: "objectgroup", id: 99, name: "Collision", objects: [], visible: true, opacity: 1, properties: {} };
    expect(rules(model)).toContain("layer-kind");
  });

  it("layer-order fires when the stack is out of order", () => {
    const model = goodMap();
    const [ground, walls] = [model.layers[0]!, model.layers[1]!];
    model.layers[0] = walls;
    model.layers[1] = ground;
    expect(rules(model)).toContain("layer-order");
  });

  it("layer-unknown warns about a layer outside the schema", () => {
    const model = goodMap();
    model.layers.push({ kind: "tilelayer", id: 50, name: "Scratch", width: 8, height: 6, data: new Array(48).fill(0), visible: true, opacity: 1, properties: {} });
    expect(rules(model)).toContain("layer-unknown");
  });

  it("tile-size fires when the map is not on the project grid", () => {
    const model = goodMap();
    model.tileWidth = 16;
    model.tileHeight = 16;
    expect(rules(model)).toContain("tile-size");
  });

  it("layer-size fires when a tile layer disagrees with the map", () => {
    const model = goodMap();
    model.width = 9;
    expect(rules(model)).toContain("layer-size");
  });
});

describe("tileset rules", () => {
  it("tileset-not-vendored fires when the .tsj does not exist", () => {
    expect(rules(goodMap(), { ...CONTEXT, vendoredTilesets: new Set() })).toContain("tileset-not-vendored");
  });

  it("tileset-tile-size fires when the art is drawn for another grid", () => {
    expect(rules(goodMap(), { ...CONTEXT, tileSizes: new Map([["office-core", 16]]) })).toContain("tileset-tile-size");
  });

  it("firstgid-collision fires when two tilesets claim the same range start", () => {
    const model = goodMap();
    model.tilesets.push({ firstgid: 1, source: "../tilesets/decor-pack.tsj", id: "decor-pack", tileCount: 10 });
    expect(rules(model, { ...CONTEXT, vendoredTilesets: new Set(["office-core", "decor-pack"]) })).toContain("firstgid-collision");
  });

  it("gid-unresolved fires for a tile beyond the tileset's range", () => {
    const model = goodMap();
    tileLayer(model, "Ground").data[0] = 9999;
    expect(rules(model)).toContain("gid-unresolved");
  });

  it("gid-unresolved fires for an object gid too, and ignores flip flags", () => {
    const model = goodMap();
    const desk = objectLayer(model, "Furniture").objects[0]!;
    desk.gid = 0x80000000 | 43;
    expect(rules(model)).not.toContain("gid-unresolved");
    desk.gid = 5000;
    expect(rules(model)).toContain("gid-unresolved");
  });
});

describe("object rules", () => {
  it("object-class-unknown fires for a class outside the schema", () => {
    const model = goodMap();
    objectLayer(model, "Furniture").objects[0]!.class = "teleporter";
    expect(rules(model)).toContain("object-class-unknown");
  });

  it("property-missing fires when a required property is absent", () => {
    const model = goodMap();
    delete objectLayer(model, "Furniture").objects[0]!.properties.capacity;
    expect(rules(model)).toContain("property-missing");
  });

  it("property-type fires when a property has the wrong type", () => {
    const model = goodMap();
    objectLayer(model, "Furniture").objects[0]!.properties.capacity = "four";
    expect(rules(model)).toContain("property-type");
  });

  it("property-enum fires for a value outside the allowed set", () => {
    const model = goodMap();
    objectLayer(model, "InteractionZones").objects[0]!.properties.kind = "telepathy";
    expect(rules(model)).toContain("property-enum");
  });

  it("property-unknown warns about an unmodelled property", () => {
    const model = goodMap();
    objectLayer(model, "Furniture").objects[0]!.properties.colour = "blue";
    expect(rules(model)).toContain("property-unknown");
  });

  it("object-id-duplicate fires when two objects share an id", () => {
    const model = goodMap();
    objectLayer(model, "SpawnPoints").objects[0]!.id = 1;
    expect(rules(model)).toContain("object-id-duplicate");
  });

  it("object-out-of-bounds fires for an object off the map", () => {
    const model = goodMap();
    objectLayer(model, "Furniture").objects[0]!.x = 9000;
    expect(rules(model)).toContain("object-out-of-bounds");
  });

  it("object-layer warns when a class sits on a layer it does not belong on", () => {
    const model = goodMap();
    const zone = objectLayer(model, "InteractionZones").objects.pop()!;
    objectLayer(model, "Furniture").objects.push(zone);
    expect(rules(model)).toContain("object-layer");
  });

  it("does not warn about art that is also a gameplay object", () => {
    // A desk pod is a sprite on Furniture and a workstation the runtime reads.
    expect(rules(goodMap())).not.toContain("object-layer");
  });

  it("object-unclassified warns about an object with no class", () => {
    const model = goodMap();
    objectLayer(model, "Furniture").objects[0]!.class = "";
    expect(rules(model)).toContain("object-unclassified");
  });
});

describe("gameplay rules", () => {
  it("spawn-missing fires when there is no spawn at all", () => {
    const model = goodMap();
    objectLayer(model, "SpawnPoints").objects = [];
    expect(rules(model)).toContain("spawn-missing");
  });

  it("spawn-default-missing fires when no spawn is the default", () => {
    const model = goodMap();
    objectLayer(model, "SpawnPoints").objects[0]!.properties.default = false;
    expect(rules(model)).toContain("spawn-default-missing");
  });

  it("spawn-default-duplicate fires when two spawns claim default", () => {
    const model = goodMap();
    const spawns = objectLayer(model, "SpawnPoints");
    spawns.objects.push({ ...spawns.objects[0]!, id: 42, properties: { id: "second", default: true } });
    expect(rules(model)).toContain("spawn-default-duplicate");
  });

  it("spawn-blocked fires when the spawn tile is not walkable", () => {
    const model = goodMap();
    tileLayer(model, "Collision").data[1 * 8 + 1] = 1;
    expect(rules(model)).toContain("spawn-blocked");
  });

  it("unreachable-area warns when part of the floor is walled off", () => {
    const model = goodMap();
    // Seal the right-hand half off from the spawn.
    const collision = tileLayer(model, "Collision");
    for (let y = 0; y < 6; y += 1) collision.data[y * 8 + 3] = 1;
    expect(rules(model)).toContain("unreachable-area");
  });

  it("stays quiet when everything is reachable", () => {
    expect(rules(goodMap())).not.toContain("unreachable-area");
  });

  it("zone-overlap warns when two zones of different kinds overlap", () => {
    const model = goodMap();
    const zones = objectLayer(model, "InteractionZones");
    zones.objects.push({ ...zones.objects[0]!, id: 77, properties: { id: "booth-2", kind: "screen-share" } });
    expect(rules(model)).toContain("zone-overlap");
  });

  it("does not warn about two overlapping zones of the same kind", () => {
    const model = goodMap();
    const zones = objectLayer(model, "InteractionZones");
    zones.objects.push({ ...zones.objects[0]!, id: 78, properties: { id: "booth-3", kind: "audio-private" } });
    expect(rules(model)).not.toContain("zone-overlap");
  });
});

describe("severity", () => {
  it("warnings alone leave the map valid", () => {
    const model = goodMap();
    objectLayer(model, "Furniture").objects[0]!.properties.colour = "blue";
    const result = validateMap(model, CONTEXT);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/0 errors and 1 warning/);
  });

  it("a single error makes the map invalid", () => {
    const model = goodMap();
    objectLayer(model, "SpawnPoints").objects = [];
    expect(validateMap(model, CONTEXT).ok).toBe(false);
  });
});
