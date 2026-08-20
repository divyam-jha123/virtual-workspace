#!/usr/bin/env node
/**
 * Generates a real, Tiled-openable placeholder tileset so the map tools can be
 * exercised end to end before any licensed art exists.
 *
 * Writes content/tilesets/placeholder-office.{png,tsj} and a matching
 * content/assets/placeholder-catalog.json. Everything is deliberately flat and
 * ugly: it is scaffolding for testing the pipeline, not art direction.
 *
 *   node tools/map-mcp/scripts/make-placeholder-tileset.mjs
 */
import fs from "node:fs";
import { encodePng } from "./lib/png.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TILE = 32;
const COLS = 8;
const ROWS = 8;
const W = COLS * TILE;
const H = ROWS * TILE;

// ------------------------------------------------------------------- drawing

const pixels = Buffer.alloc(W * H * 4); // transparent by default

function px(x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

/** Rect in tile-local coordinates, for the tile at index `id`. */
function rect(id, x0, y0, w, h, colour) {
  const ox = (id % COLS) * TILE;
  const oy = Math.floor(id / COLS) * TILE;
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) px(ox + x, oy + y, colour);
}

function fill(id, colour) {
  rect(id, 0, 0, TILE, TILE, colour);
}

/** A 1px inner border, so tile boundaries are visible in Tiled. */
function outline(id, colour) {
  rect(id, 0, 0, TILE, 1, colour);
  rect(id, 0, TILE - 1, TILE, 1, colour);
  rect(id, 0, 0, 1, TILE, colour);
  rect(id, TILE - 1, 0, 1, TILE, colour);
}

const C = {
  floorLight: [214, 211, 202],
  floorDark: [198, 194, 184],
  wood: [181, 141, 96],
  woodDark: [140, 104, 66],
  wall: [92, 96, 107],
  wallTop: [126, 131, 143],
  door: [150, 96, 58],
  glass: [138, 190, 214],
  desk: [166, 124, 82],
  deskTop: [196, 158, 116],
  chair: [64, 68, 78],
  plantPot: [156, 96, 66],
  plantLeaf: [86, 148, 84],
  sofa: [96, 116, 150],
  rug: [176, 96, 104],
  screen: [46, 50, 60],
  screenLit: [110, 170, 200],
  shelf: [126, 92, 60],
  grid: [0, 0, 0, 40],
};

// 0 is left fully transparent: Tiled and the runtime both treat gid 0 as empty.

fill(1, C.floorLight); outline(1, C.grid);                     // plain floor
fill(2, C.floorDark); outline(2, C.grid);                      // floor variant
fill(3, C.wood); rect(3, 0, 8, TILE, 2, C.woodDark); rect(3, 0, 20, TILE, 2, C.woodDark); outline(3, C.grid); // wood
fill(4, C.wall);                                               // wall
fill(5, C.wall); rect(5, 0, 0, TILE, 8, C.wallTop);            // wall with top edge
fill(6, C.floorLight); rect(6, 4, 2, 24, 28, C.door); rect(6, 22, 14, 3, 4, [230, 210, 120]); // door
fill(7, C.wall); rect(7, 4, 6, 24, 18, C.glass);               // window
fill(8, C.floorLight); rect(8, 2, 10, 28, 16, C.desk); rect(8, 2, 10, 28, 4, C.deskTop); // desk
fill(9, C.floorLight); rect(9, 8, 10, 16, 16, C.chair); rect(9, 8, 6, 16, 5, C.chair);   // chair
fill(10, C.floorLight); rect(10, 12, 20, 8, 8, C.plantPot); rect(10, 8, 6, 16, 14, C.plantLeaf); // plant
fill(11, C.floorLight); rect(11, 2, 12, 28, 14, C.sofa); rect(11, 2, 8, 28, 6, [116, 136, 170]); // sofa
fill(12, C.rug); outline(12, [150, 76, 84]);                   // rug
fill(13, C.floorLight); rect(13, 4, 6, 24, 16, C.screen); rect(13, 6, 8, 20, 12, C.screenLit); rect(13, 13, 22, 6, 4, C.screen); // monitor
fill(14, C.floorLight); rect(14, 4, 8, 24, 18, C.woodDark); rect(14, 6, 10, 20, 14, C.wood); // table
fill(15, C.floorLight); rect(15, 3, 4, 26, 24, C.shelf); rect(15, 5, 8, 22, 3, [200, 90, 80]); rect(15, 5, 15, 22, 3, [90, 130, 190]); rect(15, 5, 22, 22, 3, [210, 180, 90]); // bookshelf

// ---- Thin walls (ids 16..31) -------------------------------------------
// A wall run should read as a slim slab over the floor, not a solid 32px
// block. One tile per 4-bit neighbour mask (N=1 E=2 S=4 W=8) so straights,
// corners, tees and crosses all line up: tile id = 16 + mask.

const WALL_T = 10;                   // slab thickness, px
const A = (TILE - WALL_T) / 2;       // 11 - where the slab starts
const B = A + WALL_T;                // 21 - where the slab ends

function thinWall(id, mask, slab, top) {
  fill(id, C.floorLight);
  outline(id, C.grid);
  if (mask & 1) rect(id, A, 0, WALL_T, A, slab);         // north arm
  if (mask & 4) rect(id, A, B, WALL_T, TILE - B, slab);  // south arm
  if (mask & 8) rect(id, 0, A, A, WALL_T, slab);         // west arm
  if (mask & 2) rect(id, B, A, TILE - B, WALL_T, slab);  // east arm
  rect(id, A, A, WALL_T, WALL_T, slab);                  // junction core
  // 2px highlight on every upward-facing edge, so the slab has a little depth.
  if (mask & 8) rect(id, 0, A, A, 2, top);
  if (mask & 2) rect(id, B, A, TILE - B, 2, top);
  if (!(mask & 1)) rect(id, A, A, WALL_T, 2, top);
}

for (let mask = 0; mask < 16; mask += 1) thinWall(16 + mask, mask, C.wall, C.wallTop);

// Glazed variants of the same slab: 32 = horizontal run, 33 = vertical run.
thinWall(32, 0b1010, C.wall, C.wallTop);
rect(32, 0, A + 3, TILE, WALL_T - 5, C.glass);
thinWall(33, 0b0101, C.wall, C.wallTop);
rect(33, A + 3, 0, WALL_T - 5, TILE, C.glass);

// Remaining tiles: numbered swatches, so any stray gid is obvious on sight.
for (let id = 34; id < COLS * ROWS; id += 1) {
  const hue = (id * 37) % 360;
  const c = hslToRgb(hue / 360, 0.35, 0.62);
  fill(id, c);
  outline(id, [0, 0, 0, 60]);
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}

// -------------------------------------------------------------------- output

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tilesets = path.join(root, "content", "tilesets");
const assets = path.join(root, "content", "assets");
fs.mkdirSync(tilesets, { recursive: true });
fs.mkdirSync(assets, { recursive: true });

fs.writeFileSync(path.join(tilesets, "placeholder-office.png"), encodePng(pixels, W, H));

const tsj = {
  columns: COLS,
  image: "placeholder-office.png",
  imageheight: H,
  imagewidth: W,
  margin: 0,
  name: "placeholder-office",
  spacing: 0,
  tilecount: COLS * ROWS,
  tiledversion: "1.11.0",
  tileheight: TILE,
  tilewidth: TILE,
  type: "tileset",
  version: "1.10",
  // Per-tile `collides` so the runtime can use setCollisionByProperty later.
  // 16..31 are the thin-wall mask set, 32/33 the glazed variants.
  tiles: [4, 5, 7, 15, ...Array.from({ length: 18 }, (_, i) => 16 + i)]
    .map((id) => ({ id, properties: [{ name: "collides", type: "bool", value: true }] })),
};
fs.writeFileSync(path.join(tilesets, "placeholder-office.tsj"), `${JSON.stringify(tsj, null, 2)}\n`);

const catalogEntry = (id, name, category, tags, tileId, dimensions, extra = {}) => ({
  id, name, category, tags, style: "placeholder", tileSize: TILE,
  dimensions, placement: "floor", tilesetId: "placeholder-office", tileId, version: "1", ...extra,
});

const catalog = {
  assets: [
    catalogEntry("ph.desk", "Placeholder desk", "furniture", ["desk", "workstation"], 8, { width: 2, height: 1 },
      { collision: { blocking: true }, interaction: { class: "workstation", capacity: 2 } }),
    catalogEntry("ph.chair", "Placeholder chair", "furniture", ["chair", "seat"], 9, { width: 1, height: 1 },
      { collision: { blocking: false }, interaction: { class: "seat", facing: "up", seatType: "deskchair" } }),
    catalogEntry("ph.plant", "Placeholder plant", "decoration", ["plant", "greenery"], 10, { width: 1, height: 1 },
      { collision: { blocking: true } }),
    catalogEntry("ph.sofa", "Placeholder sofa", "furniture", ["sofa", "couch"], 11, { width: 2, height: 1 },
      { collision: { blocking: true } }),
    catalogEntry("ph.rug", "Placeholder rug", "decoration", ["rug", "carpet"], 12, { width: 2, height: 2 }),
    catalogEntry("ph.monitor", "Placeholder monitor", "furniture", ["screen", "monitor"], 13, { width: 1, height: 1 },
      { collision: { blocking: true } }),
    // A table is furniture, not a room: the "meeting-room" class is an authored
    // rectangle over the whole space, added with add_object.
    catalogEntry("ph.table", "Placeholder round table", "furniture", ["table"], 14, { width: 2, height: 2 },
      { collision: { blocking: true } }),
    catalogEntry("ph.bookshelf", "Placeholder bookshelf", "furniture", ["bookshelf", "shelf"], 15, { width: 1, height: 1 },
      { collision: { blocking: true } }),
  ],
};
fs.writeFileSync(path.join(assets, "placeholder-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

console.log(`Wrote ${W}x${H} tileset  -> content/tilesets/placeholder-office.png`);
console.log(`Wrote tileset json       -> content/tilesets/placeholder-office.tsj`);
console.log(`Wrote ${catalog.assets.length} catalog assets -> content/assets/placeholder-catalog.json`);
console.log(`\nUseful tile ids: 1 floor, 2 floor-alt, 3 wood, 4 wall, 5 wall-top, 6 door, 7 window`);
console.log(`Thin walls: 16 + (N=1|E=2|S=4|W=8); 32 window-h, 33 window-v`);
