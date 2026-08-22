#!/usr/bin/env node
/**
 * Authors content/maps/vorkium-hq.tmj — the Vorkium campus, built in stages.
 *
 * STAGE 1 (all that is in here so far): the car park.
 *
 *   A grass plot with a surfaced car park down the west edge: a column of
 *   marked "P" bays, cars nosed in, a drive aisle beside them, and an exit at
 *   the south with a boom barrier and an attendant's booth.
 *
 * The office block and the garden are NOT placed yet.
 *
 * Three things about this art pack that decide the tile choices below, all
 * learned by looking at the pixels rather than at the names:
 *
 *   1. grass_1_1..8 are EDGE tiles with a dirt border baked in. Only
 *      grass_1_9/10/11/12/22 tile seamlessly; 13/16/17/20 are speckled with
 *      red flowers that read as litter when used as a field fill.
 *   2. asphalt_1_variation_1..15 are road MARKINGS, and every one of them is
 *      inset 2px on all four sides, so they can never join into a continuous
 *      painted line — they are single, standalone marks by design. The plain
 *      road surface is variation_16..23.
 *   3. The real parking-bay art is sidewalk_1_45/46: a 5x2 ready-made bay,
 *      kerb and "P" included. 5x2 is the ground FOOTPRINT of a car; the car
 *      sprite is 3 tall because it also draws the car's height, so a car is
 *      bottom-aligned to its bay and overhangs one row upward.
 *
 *   node tools/map-mcp/scripts/make-vorkium-hq.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TILE = 16;
const WIDTH = 120;
const HEIGHT = 78;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTENT = path.join(root, "content");

// ---------------------------------------------------------------- catalogs
const CATALOGS = [
  "limezu-city_terrains-catalog.json",
  "limezu-terrains_and_fences-catalog.json",
  "limezu-vehicles-catalog.json",
  "limezu-city_props-catalog.json",
  "limezu-police_station-catalog.json",
];
const ASSETS = new Map();
for (const file of CATALOGS) {
  for (const a of JSON.parse(fs.readFileSync(path.join(CONTENT, "assets", file), "utf8")).assets) {
    ASSETS.set(a.id, a);
  }
}

const TILESETS = [
  "limezu-city_terrains",
  "limezu-terrains_and_fences",
  "limezu-vehicles",
  "limezu-city_props",
  "limezu-police_station",
];
const firstgid = {};
let cursor = 1;
for (const id of TILESETS) {
  firstgid[id] = cursor;
  cursor += JSON.parse(fs.readFileSync(path.join(CONTENT, "tilesets", `${id}.tsj`), "utf8")).tilecount;
}

const asset = (id) => {
  const a = ASSETS.get(id);
  if (!a) throw new Error(`unknown asset ${id}`);
  return a;
};
const gid = (id) => {
  const a = asset(id);
  return firstgid[a.tilesetId] + a.tileId;
};

// Flat fills only — see note 1 and 2 in the header.
const GRASS = [22, 22, 9, 10, 11, 12].map((v) => gid(`limezu.terrains_and_fences.grass_1_${v}`));
const ASPHALT = [16, 17, 18, 19, 21].map((v) => gid(`limezu.city_terrains.asphalt_1_variation_${v}`));
const ASPHALT_WORN = [22, 23].map((v) => gid(`limezu.city_terrains.asphalt_1_variation_${v}`));

let seed = 7_310_215; // deterministic: re-running produces an identical map
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ------------------------------------------------------------- the car park
//   bays  x 4..8    5 wide, the width of one bay
//   aisle x 9..15   the drive lane the bays open onto
const BAY_X = 4;
const BAY_W = 5;
const LOT_X0 = 3;
const LOT_X1 = 15;
const LOT_Y0 = 6;
const BAY_Y0 = 8;
const BAY_PITCH = 3;   // 2 rows of bay + 1 row of clear asphalt
const BAY_COUNT = 18;
const LOT_Y1 = BAY_Y0 + (BAY_COUNT - 1) * BAY_PITCH + 3;

// The exit runs from the foot of the lot to the southern edge of the plot.
const EXIT_X0 = 10;
const EXIT_X1 = LOT_X1;

// -------------------------------------------------------------------- grid
const blank = () => new Array(WIDTH * HEIGHT).fill(0);
const at = (x, y) => y * WIDTH + x;

const ground = blank();
const details = blank();
const walls = blank();
const collision = blank();

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) ground[at(x, y)] = pick(GRASS);
}
const pave = (x, y) => { ground[at(x, y)] = rnd() < 0.06 ? pick(ASPHALT_WORN) : pick(ASPHALT); };
for (let y = LOT_Y0; y <= LOT_Y1; y += 1) {
  for (let x = LOT_X0; x <= LOT_X1; x += 1) pave(x, y);
}
for (let y = LOT_Y1 + 1; y < HEIGHT; y += 1) {
  for (let x = EXIT_X0; x <= EXIT_X1; x += 1) pave(x, y);
}

// ------------------------------------------------------------------ objects
let nextId = 1;
const furniture = [];   // bay markings — drawn under everything else
const decorations = []; // cars, barrier, booth
const objects = [];
const spawns = [];
const zones = [];

function place(id, x, y, { layer = decorations, name } = {}) {
  const a = asset(id);
  const { width, height } = a.dimensions;
  if (x < 0 || y < 0 || x + width > WIDTH || y + height > HEIGHT) {
    throw new Error(`${id} at (${x},${y}) falls outside the ${WIDTH}x${HEIGHT} plot`);
  }
  layer.push({
    id: nextId++,
    name: name ?? a.name,
    class: "",
    gid: gid(id),
    x: x * TILE,
    y: (y + height) * TILE, // Tiled anchors tile objects bottom-left
    width: width * TILE,
    height: height * TILE,
    rotation: 0,
    visible: true,
    properties: {},
  });
  if (a.collision?.blocking) {
    for (let dy = 0; dy < height; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) collision[at(x + dx, y + dy)] = ASPHALT[0];
    }
  }
}

const rect = (layer, klass, name, x, y, w, h, properties) =>
  layer.push({ id: nextId++, name, class: klass, x: x * TILE, y: y * TILE, width: w * TILE, height: h * TILE, rotation: 0, visible: true, properties });

// -- bays, then the cars sitting in them. Only the 5x3 car sprites are used so
// a car exactly fills the 5-wide bay. Some bays are left free.
const CARS = [7, 9, 10, 11, 12, 13, 15, 16, 18, 20, 21, 23, 25, 26].map((n) => `limezu.vehicles.car_left_${n}`);
const EMPTY = new Set([2, 6, 9, 13, 16]);
let carN = 0;
for (let b = 0; b < BAY_COUNT; b += 1) {
  const top = BAY_Y0 + b * BAY_PITCH;
  place("limezu.city_terrains.sidewalk_1_46", BAY_X, top, { layer: furniture, name: `Bay ${b + 1}` });
  if (EMPTY.has(b)) continue;
  // bottom-aligned to the bay: the bay is 2 rows, the sprite 3
  place(CARS[carN++ % CARS.length], BAY_X, top - 1, { layer: decorations });
}

// -- exit: boom barrier across the lane, attendant's booth on the grass beside it
const BARRIER_Y = LOT_Y1 + 5;
place("limezu.city_props.stop_barrier_front", EXIT_X0, BARRIER_Y);
place("limezu.police_station.parking_booth_1", EXIT_X1 + 2, BARRIER_Y - 3);

// -- plot boundary, so nobody walks off the edge
for (let x = 0; x < WIDTH; x += 1) { collision[at(x, 0)] = ASPHALT[0]; collision[at(x, HEIGHT - 1)] = ASPHALT[0]; }
for (let y = 0; y < HEIGHT; y += 1) { collision[at(0, y)] = ASPHALT[0]; collision[at(WIDTH - 1, y)] = ASPHALT[0]; }

rect(spawns, "spawn", "Car park", 12, LOT_Y1 - 4, 1, 1, { id: "main", default: true });
rect(zones, "interaction-zone", "Car park", LOT_X0, LOT_Y0, LOT_X1 - LOT_X0 + 1, LOT_Y1 - LOT_Y0 + 1, { id: "car-park", kind: "trigger" });

// ------------------------------------------------------------------- output
const propType = (v) => (typeof v === "boolean" ? "bool" : typeof v === "number" ? "int" : "string");
const serialize = (bag) => {
  const names = Object.keys(bag).sort();
  return names.length ? names.map((name) => ({ name, type: propType(bag[name]), value: bag[name] })) : undefined;
};
const withProps = (o) => {
  const props = serialize(o.properties);
  const { properties, ...rest } = o;
  return props ? { ...rest, properties: props } : rest;
};

let layerId = 1;
const tileLayer = (name, data, extra = {}) => ({
  data, height: HEIGHT, id: layerId++, name, opacity: 1, type: "tilelayer", visible: true, width: WIDTH, x: 0, y: 0, ...extra,
});
const objectLayer = (name, list, extra = {}) => ({
  draworder: "topdown", id: layerId++, name, objects: list.map(withProps), opacity: 1, type: "objectgroup", visible: true, x: 0, y: 0, ...extra,
});

const map = {
  compressionlevel: -1,
  height: HEIGHT,
  infinite: false,
  layers: [
    tileLayer("Ground", ground),
    tileLayer("Ground_Details", details),
    tileLayer("Walls", walls),
    objectLayer("Furniture", furniture),
    objectLayer("Decorations", decorations),
    tileLayer("Collision", collision, { visible: false, opacity: 0.45 }),
    objectLayer("Objects", objects),
    objectLayer("SpawnPoints", spawns),
    objectLayer("InteractionZones", zones),
    tileLayer("AbovePlayer", blank()),
  ],
  nextlayerid: layerId,
  nextobjectid: nextId,
  orientation: "orthogonal",
  properties: [{ name: "name", type: "string", value: "Vorkium HQ" }],
  renderorder: "right-down",
  tiledversion: "1.11.0",
  tileheight: TILE,
  tilesets: TILESETS.map((id) => ({ firstgid: firstgid[id], source: `../tilesets/${id}.tsj` })),
  tilewidth: TILE,
  type: "map",
  version: "1.10",
  width: WIDTH,
};

fs.writeFileSync(path.join(CONTENT, "maps", "vorkium-hq.tmj"), `${JSON.stringify(map, null, 1)}\n`);
console.log(`Wrote ${WIDTH}x${HEIGHT} (${WIDTH * TILE}x${HEIGHT * TILE}px) -> content/maps/vorkium-hq.tmj`);
console.log(`  car park: ${BAY_COUNT} bays, ${BAY_COUNT - EMPTY.size} cars, ${EMPTY.size} free`);
