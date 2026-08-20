#!/usr/bin/env node
/**
 * Authors content/maps/office-hq.tmj: a 64x44 office floor on the 16px grid.
 *
 * Written as a generator rather than by hand so the layout stays readable and
 * re-runnable — the wall joins, collision footprints and door gaps are all
 * derived, not typed out 2,816 tiles at a time. Run validate_map afterwards.
 *
 *   node tools/map-mcp/scripts/make-office-hq.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TILE = 16;
const WIDTH = 64;
const HEIGHT = 44;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "content", "assets", "office-catalog.json"), "utf8"));
const ASSETS = new Map(catalog.assets.map((a) => [a.id, a]));

const gid = (tileId) => tileId + 1; // the map binds office-16 at firstgid 1

// ------------------------------------------------------------------ regions

const ROOMS = {
  reception: { x0: 1, y0: 1, x1: 20, y1: 11, floor: 6 },
  lounge: { x0: 22, y0: 1, x1: 62, y1: 11, floor: 3 },
  corridor: { x0: 1, y0: 13, x1: 62, y1: 15, floor: 2 },
  desks: { x0: 1, y0: 17, x1: 33, y1: 42, floor: 1 },
  focus: { x0: 35, y0: 17, x1: 46, y1: 28, floor: 7 },
  board: { x0: 48, y0: 17, x1: 62, y1: 28, floor: 7 },
  kitchen: { x0: 35, y0: 30, x1: 62, y1: 42, floor: 4 },
};

const inside = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

function floorAt(x, y) {
  for (const room of Object.values(ROOMS)) if (inside(room, x, y)) return room.floor;
  return ROOMS.corridor.floor; // under the walls and along the shell
}

// -------------------------------------------------------------------- walls
// 0 = open, 1 = solid, 2 = glass partition. Glass fronts the meeting rooms so
// the floor still reads as one space from the desks.

const wall = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(0));
const run = (x0, y0, x1, y1, kind) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) wall[y][x] = kind;
};

run(0, 0, WIDTH - 1, 0, 1);                 // shell
run(0, HEIGHT - 1, WIDTH - 1, HEIGHT - 1, 1);
run(0, 0, 0, HEIGHT - 1, 1);
run(WIDTH - 1, 0, WIDTH - 1, HEIGHT - 1, 1);

run(1, 12, 62, 12, 1);                      // reception/lounge -> corridor
run(1, 16, 34, 16, 1);                      // corridor -> open floor
run(35, 16, 62, 16, 2);                     // corridor -> meeting rooms (glass)
run(21, 1, 21, 11, 1);                      // reception | lounge
run(34, 17, 34, 28, 2);                     // open floor | focus (glass)
run(34, 29, 34, 42, 1);                     // open floor | kitchen
run(47, 17, 47, 28, 2);                     // focus | boardroom (glass)
run(35, 29, 62, 29, 1);                     // meeting rooms | kitchen

/** Doorways: holes in the wall, plus a threshold tile and a `door` object. */
const DOORS = [
  { name: "Main entrance", x0: 9, y0: 0, x1: 10, y1: 0, target: "lobby", axis: "h" },
  { name: "Reception door", x0: 10, y0: 12, x1: 11, y1: 12, target: "main", axis: "h" },
  { name: "Lounge door", x0: 40, y0: 12, x1: 41, y1: 12, target: "lounge", axis: "h" },
  { name: "Floor door west", x0: 10, y0: 16, x1: 11, y1: 16, target: "desks", axis: "h" },
  { name: "Floor door east", x0: 26, y0: 16, x1: 27, y1: 16, target: "desks", axis: "h" },
  { name: "Focus room door", x0: 40, y0: 16, x1: 41, y1: 16, target: "focus", axis: "h" },
  { name: "Boardroom door", x0: 54, y0: 16, x1: 55, y1: 16, target: "boardroom", axis: "h" },
  { name: "Kitchen door", x0: 34, y0: 35, x1: 34, y1: 36, target: "kitchen", axis: "v" },
];
for (const d of DOORS) run(d.x0, d.y0, d.x1, d.y1, 0);

const isWall = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT && wall[y][x] !== 0;

function wallGid(x, y) {
  const kind = wall[y][x];
  if (kind === 0) return 0;
  const mask =
    (isWall(x, y - 1) ? 1 : 0) | (isWall(x + 1, y) ? 2 : 0) |
    (isWall(x, y + 1) ? 4 : 0) | (isWall(x - 1, y) ? 8 : 0);
  return gid((kind === 2 ? 32 : 16) + mask);
}

// ------------------------------------------------------------------- layers

const blank = () => new Array(WIDTH * HEIGHT).fill(0);
const at = (x, y) => y * WIDTH + x;

const ground = blank();
const details = blank();
const walls = blank();
const collision = blank();

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    ground[at(x, y)] = gid(floorAt(x, y));
    walls[at(x, y)] = wallGid(x, y);
    if (wall[y][x] !== 0) collision[at(x, y)] = gid(15);
  }
}

// Rugs zone the open areas without adding objects to collide with.
const rug = (x0, y0, x1, y1) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) details[at(x, y)] = gid(5);
};
rug(2, 7, 7, 10);     // reception waiting
rug(26, 3, 37, 9);    // lounge
rug(2, 38, 9, 41);    // open-floor breakout

for (const d of DOORS) {
  for (let y = d.y0; y <= d.y1; y += 1) {
    for (let x = d.x0; x <= d.x1; x += 1) details[at(x, y)] = gid(d.axis === "h" ? 48 : 49);
  }
}

// ------------------------------------------------------------------ objects

let nextId = 1;
const furniture = [];
const decorations = [];
const objects = [];
const spawns = [];
const zones = [];

/** Places a catalog asset: tile object, plus its collision footprint. */
function place(assetId, x, y, { layer = furniture, name, properties = {} } = {}) {
  const asset = ASSETS.get(assetId);
  if (!asset) throw new Error(`unknown asset ${assetId}`);
  const { width, height } = asset.dimensions;
  if (x < 0 || y < 0 || x + width > WIDTH || y + height > HEIGHT) {
    throw new Error(`${assetId} at (${x}, ${y}) falls outside the map`);
  }
  const props = { ...properties };
  let klass = "";
  if (asset.interaction) {
    const { class: c, ...rest } = asset.interaction;
    klass = c;
    Object.assign(props, rest, properties);
  }
  furnitureCheck(asset, x, y);
  layer.push({
    id: nextId++,
    name: name ?? asset.name,
    class: klass,
    gid: gid(asset.tileId),
    x: x * TILE,
    y: (y + height) * TILE, // Tiled anchors tile objects bottom-left
    width: width * TILE,
    height: height * TILE,
    rotation: 0,
    visible: true,
    properties: props,
  });
  if (asset.collision?.blocking) {
    for (let dy = 0; dy < height; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) collision[at(x + dx, y + dy)] = gid(15);
    }
  }
}

/** Catches art dropped on top of a wall, which is invisible in a screenshot. */
function furnitureCheck(asset, x, y) {
  const { width, height } = asset.dimensions;
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      if (wall[y + dy][x + dx] !== 0) throw new Error(`${asset.id} at (${x}, ${y}) overlaps a wall`);
    }
  }
}

/** Places a plain rectangle object: rooms, doors, spawns, zones. */
function rectObject(layer, klass, name, x, y, width, height, properties) {
  layer.push({
    id: nextId++,
    name,
    class: klass,
    x: x * TILE,
    y: y * TILE,
    width: width * TILE,
    height: height * TILE,
    rotation: 0,
    visible: true,
    properties,
  });
}

const chair = (x, y, facing) => place("office.chair", x, y, { properties: { facing } });
const stool = (x, y, facing) => place("office.stool", x, y, { properties: { facing } });

// --- reception
place("office.reception-desk", 8, 5);
place("office.sofa", 2, 8);
place("office.sofa", 4, 8);
place("office.coffee-table", 2, 10);
place("office.armchair", 7, 8);
place("office.water-cooler", 18, 5);
place("office.bookshelf", 19, 9);
place("office.plant-tall", 1, 1, { layer: decorations });
place("office.plant-tall", 19, 1, { layer: decorations });

// --- lounge: sofas facing a shared screen, cafe tables along the east end
place("office.screen", 31, 1);
place("office.sofa", 28, 3);
place("office.sofa", 31, 3);
place("office.sofa", 28, 8);
place("office.sofa", 31, 8);
place("office.coffee-table", 30, 5);
place("office.armchair", 26, 5);
place("office.armchair", 35, 5);
for (const tx of [44, 49, 54]) {
  place("office.table.cafe", tx, 3);
  stool(tx - 1, 3, "right");
  stool(tx + 2, 3, "left");
  stool(tx, 5, "up");
  stool(tx + 1, 1, "down");
}
place("office.bookshelf", 61, 5);
for (const [x, y] of [[23, 1], [60, 1], [23, 10], [60, 10]]) {
  place("office.plant-tall", x, y, { layer: decorations });
}

// --- open floor: 12 four-desk pods, back to back with an aisle between columns
for (const px of [2, 10, 18, 26]) {
  for (const py of [18, 25, 32]) {
    for (const dx of [1, 3]) {
      place("office.desk", px + dx, py + 1);
      chair(px + dx, py + 2, "up");
      place("office.desk", px + dx, py + 3);
      chair(px + dx, py + 4, "up");
    }
  }
}

// --- open-floor breakout, south-west corner
place("office.sofa", 2, 39);
place("office.sofa", 5, 39);
place("office.coffee-table", 3, 41);
place("office.water-cooler", 12, 38);
place("office.plant-tall", 10, 40, { layer: decorations });
place("office.plant", 8, 18, { layer: decorations });
place("office.plant", 24, 18, { layer: decorations });
place("office.plant-tall", 32, 17, { layer: decorations });

// --- focus room
place("office.whiteboard", 36, 21);
place("office.table.meeting", 39, 21);
chair(39, 20, "down");
chair(41, 20, "down");
chair(39, 23, "up");
chair(41, 23, "up");
place("office.plant-tall", 45, 27, { layer: decorations });

// --- boardroom
place("office.screen", 60, 21);
place("office.table.board", 52, 21);
for (const cx of [52, 54, 56]) {
  chair(cx, 20, "down");
  chair(cx, 23, "up");
}
chair(51, 21, "right");
chair(58, 21, "left");
place("office.plant-tall", 49, 27, { layer: decorations });
place("office.plant-tall", 61, 27, { layer: decorations });

// --- kitchen
place("office.counter", 36, 31);
place("office.counter", 38, 31);
place("office.counter", 40, 31);
place("office.sink", 42, 31);
place("office.coffee-machine", 44, 31);
place("office.fridge", 46, 31);
for (const tx of [38, 44, 50, 56]) {
  place("office.table.cafe", tx, 36);
  stool(tx - 1, 36, "right");
  stool(tx + 2, 36, "left");
  stool(tx, 38, "up");
  stool(tx + 1, 34, "down");
}
place("office.plant-tall", 61, 31, { layer: decorations });
place("office.plant-tall", 36, 41, { layer: decorations });

// --- rooms, doors, spawns, zones
rectObject(objects, "meeting-room", "Focus", 35, 17, 12, 12, { name: "Focus", capacity: 6, private: true });
rectObject(objects, "meeting-room", "Boardroom", 48, 17, 15, 12, { name: "Boardroom", capacity: 10, private: true });

for (const d of DOORS) {
  rectObject(objects, "door", d.name, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1, {
    locked: false,
    target: d.target,
  });
}

rectObject(spawns, "spawn", "Reception", 10, 2, 1, 1, { id: "main", default: true });
rectObject(spawns, "spawn", "Open floor", 16, 18, 1, 1, { id: "desks", default: false });
rectObject(spawns, "spawn", "Lounge", 42, 8, 1, 1, { id: "lounge", default: false });

rectObject(zones, "interaction-zone", "Focus audio", 35, 17, 12, 12, { id: "focus", kind: "audio-private" });
rectObject(zones, "interaction-zone", "Boardroom audio", 48, 17, 15, 12, { id: "boardroom", kind: "audio-private" });
rectObject(zones, "interaction-zone", "Lounge screen share", 26, 2, 13, 9, { id: "lounge", kind: "screen-share" });
rectObject(zones, "interaction-zone", "Kitchen", 35, 30, 28, 13, { id: "kitchen", kind: "trigger" });
rectObject(zones, "interaction-zone", "Reception", 1, 1, 20, 11, { id: "reception", kind: "trigger" });

// -------------------------------------------------------------------- output

const propertyType = (v) => (typeof v === "boolean" ? "bool" : typeof v === "number" ? "int" : "string");
const serialize = (bag) => {
  const names = Object.keys(bag).sort();
  return names.length ? names.map((name) => ({ name, type: propertyType(bag[name]), value: bag[name] })) : undefined;
};
const withProps = (o) => {
  const props = serialize(o.properties);
  const { properties, ...rest } = o;
  return props ? { ...rest, properties: props } : rest;
};

let layerId = 1;
const tileLayer = (name, data, extra = {}) => ({
  data, height: HEIGHT, id: layerId++, name, opacity: 1, type: "tilelayer",
  visible: true, width: WIDTH, x: 0, y: 0, ...extra,
});
const objectLayer = (name, list, extra = {}) => ({
  draworder: "topdown", id: layerId++, name, objects: list.map(withProps),
  opacity: 1, type: "objectgroup", visible: true, x: 0, y: 0, ...extra,
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
    // Ships hidden: it sits above the art, and is for authoring, not looking at.
    tileLayer("Collision", collision, { visible: false, opacity: 0.45 }),
    objectLayer("Objects", objects),
    objectLayer("SpawnPoints", spawns),
    objectLayer("InteractionZones", zones),
    tileLayer("AbovePlayer", blank()),
  ],
  nextlayerid: layerId,
  nextobjectid: nextId,
  orientation: "orthogonal",
  properties: [{ name: "name", type: "string", value: "Office HQ" }],
  renderorder: "right-down",
  tiledversion: "1.11.0",
  tileheight: TILE,
  tilesets: [{ firstgid: 1, source: "../tilesets/office-16.tsj" }],
  tilewidth: TILE,
  type: "map",
  version: "1.10",
  width: WIDTH,
};

const out = path.join(root, "content", "maps", "office-hq.tmj");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(map, null, 1)}\n`);

const blocked = collision.filter(Boolean).length;
console.log(`Wrote ${WIDTH}x${HEIGHT} @ ${TILE}px (${WIDTH * TILE}x${HEIGHT * TILE}px) -> content/maps/office-hq.tmj`);
console.log(`  ${furniture.length} furniture, ${decorations.length} decorations, ${objects.length} objects, ${spawns.length} spawns, ${zones.length} zones`);
console.log(`  ${blocked} blocked tiles of ${WIDTH * HEIGHT}`);
