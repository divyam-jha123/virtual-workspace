#!/usr/bin/env node
/**
 * The 16px office tileset: floors, a masked wall/glass set, and the furniture
 * catalogue the HQ map is built from.
 *
 * Still placeholder art — flat colour, no shading pass — but authored on the
 * project grid (TILE_SIZE = 16) so footprints, collision and the runtime all
 * agree. Writes content/tilesets/office-16.{png,tsj} and the matching
 * content/assets/office-catalog.json.
 *
 *   node tools/map-mcp/scripts/make-office-tileset.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./lib/png.mjs";

const TILE = 16;
const COLS = 16;
const ROWS = 16;
const W = COLS * TILE;
const H = ROWS * TILE;

const pixels = Buffer.alloc(W * H * 4); // transparent by default

function px(x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  if (a === 0) return;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

/**
 * A drawing surface for tile `id`.
 *
 * Multi-tile furniture is a single tile stretched to its footprint by Tiled, so
 * art for a 2x1 desk would come out horizontally smeared if it were drawn
 * square. `artist(id, w, h)` takes coordinates in the *final* pixel space
 * (w*TILE x h*TILE) and samples them down into the one tile, which cancels the
 * stretch out again.
 */
function artist(id, wTiles = 1, hTiles = 1) {
  const ox = (id % COLS) * TILE;
  const oy = Math.floor(id / COLS) * TILE;
  const rect = (x0, y0, w, h, colour) => {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        px(ox + Math.floor(x / wTiles), oy + Math.floor(y / hTiles), colour);
      }
    }
  };
  return {
    w: wTiles * TILE,
    h: hTiles * TILE,
    rect,
    fill: (colour) => rect(0, 0, wTiles * TILE, hTiles * TILE, colour),
    /** 1px inner border in final-pixel space. */
    outline: (colour) => {
      rect(0, 0, wTiles * TILE, 1, colour);
      rect(0, hTiles * TILE - 1, wTiles * TILE, 1, colour);
      rect(0, 0, 1, hTiles * TILE, colour);
      rect(wTiles * TILE - 1, 0, 1, hTiles * TILE, colour);
    },
  };
}

const C = {
  carpet: [206, 205, 199],
  carpetAlt: [196, 195, 188],
  carpetRoom: [176, 182, 190],
  corridor: [186, 186, 180],
  wood: [186, 148, 104],
  woodDark: [150, 114, 74],
  stone: [214, 214, 210],
  stoneDark: [188, 188, 184],
  kitchen: [226, 228, 230],
  kitchenAlt: [204, 208, 212],
  rug: [172, 108, 96],
  rugDark: [148, 88, 78],
  wall: [96, 100, 112],
  wallTop: [132, 137, 150],
  glass: [150, 196, 218],
  glassFrame: [110, 116, 128],
  desk: [200, 164, 122],
  deskEdge: [162, 126, 88],
  metal: [120, 126, 136],
  chair: [70, 76, 88],
  chairSeat: [96, 104, 118],
  screen: [38, 42, 52],
  screenLit: [116, 176, 206],
  sofa: [98, 118, 152],
  sofaDark: [76, 94, 124],
  leaf: [88, 150, 88],
  leafDark: [64, 118, 66],
  pot: [162, 100, 70],
  counter: [232, 232, 234],
  counterEdge: [190, 192, 196],
  fridge: [222, 226, 230],
  white: [246, 246, 244],
  grid: [0, 0, 0, 26],
  shadow: [0, 0, 0, 46],
};

// ------------------------------------------------------------------- floors
// id 0 stays transparent: Tiled and the runtime both treat gid 0 as empty.

// No per-tile outline: at 16px a 1px border on every tile turns the whole floor
// into graph paper. Tiled draws its own grid when you want one.
function floor(id, base, fleck) {
  const a = artist(id);
  a.fill(base);
  if (fleck) {
    a.rect(3, 4, 2, 1, fleck);
    a.rect(10, 7, 2, 1, fleck);
    a.rect(6, 12, 2, 1, fleck);
  }
}

floor(1, C.carpet, C.carpetAlt);       // open-office carpet
floor(2, C.corridor, C.stoneDark);     // corridor
floor(3, C.wood, C.woodDark);          // lounge wood
floor(4, C.kitchen, C.kitchenAlt);     // kitchen tile
floor(5, C.rug, C.rugDark);            // area rug
floor(6, C.stone, C.stoneDark);        // reception stone
floor(7, C.carpetRoom, C.carpetAlt);   // meeting-room carpet

// Wood floor gets a plank seam so it reads as boards, not a brown square.
{
  const a = artist(3);
  a.rect(0, 5, TILE, 1, C.woodDark);
  a.rect(0, 11, TILE, 1, C.woodDark);
}
// Kitchen tile gets a grout cross.
{
  const a = artist(4);
  a.rect(0, 8, TILE, 1, C.kitchenAlt);
  a.rect(8, 0, 1, TILE, C.kitchenAlt);
}

// 15: collision marker. The Collision layer ships hidden; switch it on in Tiled
// and blocked tiles wash red.
{
  const a = artist(15);
  a.fill([214, 72, 96, 110]);
}

// -------------------------------------------------------------------- walls
// ids 16..31 solid wall, 32..47 glass partition. Index is 16/32 + a 4-bit
// neighbour mask (N=1 E=2 S=4 W=8), so straights, corners, tees and crosses
// all join up without hand-picking tiles.

const WALL_T = 6;                  // slab thickness in px, of 16
const A = (TILE - WALL_T) / 2;     // 5
const B = A + WALL_T;              // 11

function maskTile(id, mask, { slab, top, pane }) {
  const a = artist(id);
  if (mask & 1) a.rect(A, 0, WALL_T, A, slab);
  if (mask & 4) a.rect(A, B, WALL_T, TILE - B, slab);
  if (mask & 8) a.rect(0, A, A, WALL_T, slab);
  if (mask & 2) a.rect(B, A, TILE - B, WALL_T, slab);
  a.rect(A, A, WALL_T, WALL_T, slab);
  if (pane) {
    // Glaze the straight runs only; junctions stay solid framing.
    if ((mask & 0b1010) === 0b1010) a.rect(0, A + 2, TILE, WALL_T - 4, pane);
    if ((mask & 0b0101) === 0b0101) a.rect(A + 2, 0, WALL_T - 4, TILE, pane);
  }
  // 1px highlight on upward-facing edges, so the slab has a little depth.
  if (mask & 8) a.rect(0, A, A, 1, top);
  if (mask & 2) a.rect(B, A, TILE - B, 1, top);
  if (!(mask & 1)) a.rect(A, A, WALL_T, 1, top);
}

for (let mask = 0; mask < 16; mask += 1) {
  maskTile(16 + mask, mask, { slab: C.wall, top: C.wallTop });
  maskTile(32 + mask, mask, { slab: C.glassFrame, top: C.glass, pane: C.glass });
}

// Doorway threshold: a floor tile with two jambs, dropped into a wall gap.
{
  const a = artist(48);
  a.fill(C.stone);
  a.rect(0, A, 2, WALL_T, C.wall);
  a.rect(TILE - 2, A, 2, WALL_T, C.wall);
}

// 49: the same threshold turned through 90 degrees, for a door in a vertical wall.
{
  const a = artist(49);
  a.fill(C.stone);
  a.rect(A, 0, WALL_T, 2, C.wall);
  a.rect(A, TILE - 2, WALL_T, 2, C.wall);
}

// ---------------------------------------------------------------- furniture
// Everything below is transparent-backed so it floats over whatever floor the
// map put underneath. `footprints` feeds both the .tsj and the asset catalog.

const footprints = new Map();
function art(id, w, h) {
  footprints.set(id, { width: w, height: h });
  return artist(id, w, h);
}

// 64: desk, 2x1, with a monitor and a shadow line.
{
  const a = art(64, 2, 1);
  a.rect(1, 4, 30, 11, C.desk);
  a.rect(1, 4, 30, 2, C.deskEdge);
  a.rect(1, 14, 30, 1, C.shadow);
  a.rect(11, 1, 10, 6, C.screen);
  a.rect(12, 2, 8, 4, C.screenLit);
  a.rect(15, 7, 2, 1, C.metal);
}

// 65: task chair, 1x1.
{
  const a = art(65, 1, 1);
  a.rect(4, 3, 8, 4, C.chair);
  a.rect(3, 7, 10, 6, C.chairSeat);
  a.rect(3, 13, 10, 1, C.shadow);
}

// 66: stool, 1x1.
{
  const a = art(66, 1, 1);
  a.rect(4, 6, 8, 4, C.chairSeat);
  a.rect(6, 10, 4, 4, C.metal);
  a.rect(4, 14, 8, 1, C.shadow);
}

// 67: two-seat sofa, 2x1.
{
  const a = art(67, 2, 1);
  a.rect(1, 3, 30, 11, C.sofaDark);
  a.rect(3, 6, 26, 7, C.sofa);
  a.rect(1, 3, 30, 3, C.sofa);
  a.rect(1, 14, 30, 1, C.shadow);
}

// 68: armchair, 1x1.
{
  const a = art(68, 1, 1);
  a.rect(2, 3, 12, 11, C.sofaDark);
  a.rect(4, 5, 8, 8, C.sofa);
  a.rect(2, 14, 12, 1, C.shadow);
}

// 69: coffee table, 2x1.
{
  const a = art(69, 2, 1);
  a.rect(2, 5, 28, 8, C.woodDark);
  a.rect(4, 6, 24, 5, C.wood);
  a.rect(2, 13, 28, 1, C.shadow);
}

// 70: small plant, 1x1.
{
  const a = art(70, 1, 1);
  a.rect(5, 10, 6, 5, C.pot);
  a.rect(3, 3, 10, 8, C.leaf);
  a.rect(3, 3, 10, 3, C.leafDark);
}

// 71: tall plant, 1x2.
{
  const a = art(71, 1, 2);
  a.rect(4, 24, 8, 7, C.pot);
  a.rect(2, 4, 12, 20, C.leaf);
  a.rect(2, 4, 12, 6, C.leafDark);
  a.rect(7, 20, 2, 6, C.leafDark);
}

// 72: meeting table, 4x2.
{
  const a = art(72, 4, 2);
  a.rect(2, 6, 60, 20, C.woodDark);
  a.rect(4, 8, 56, 15, C.wood);
  a.rect(2, 26, 60, 2, C.shadow);
}

// 73: boardroom table, 6x2.
{
  const a = art(73, 6, 2);
  a.rect(2, 6, 92, 20, C.woodDark);
  a.rect(4, 8, 88, 15, C.wood);
  a.rect(44, 12, 8, 7, C.screen);
  a.rect(2, 26, 92, 2, C.shadow);
}

// 74: wall screen, 2x1.
{
  const a = art(74, 2, 1);
  a.rect(1, 2, 30, 12, C.screen);
  a.rect(3, 4, 26, 8, C.screenLit);
  a.rect(14, 14, 4, 2, C.metal);
}

// 75: whiteboard, 2x1.
{
  const a = art(75, 2, 1);
  a.rect(1, 2, 30, 12, C.white);
  a.rect(1, 2, 30, 1, C.metal);
  a.rect(1, 13, 30, 2, C.metal);
  a.rect(5, 6, 12, 1, C.carpetRoom);
  a.rect(5, 9, 18, 1, C.carpetRoom);
}

// 76: kitchen counter, 2x1.
{
  const a = art(76, 2, 1);
  a.rect(0, 3, 32, 12, C.counter);
  a.rect(0, 3, 32, 2, C.counterEdge);
  a.rect(0, 9, 32, 1, C.counterEdge);
  a.rect(15, 9, 2, 6, C.counterEdge);
}

// 77: sink counter, 2x1.
{
  const a = art(77, 2, 1);
  a.rect(0, 3, 32, 12, C.counter);
  a.rect(0, 3, 32, 2, C.counterEdge);
  a.rect(9, 6, 14, 7, C.metal);
  a.rect(15, 3, 2, 4, C.metal);
}

// 78: fridge, 1x2.
{
  const a = art(78, 1, 2);
  a.rect(1, 1, 14, 30, C.fridge);
  a.rect(1, 1, 14, 2, C.counterEdge);
  a.rect(1, 15, 14, 1, C.counterEdge);
  a.rect(11, 6, 2, 6, C.metal);
  a.rect(11, 19, 2, 6, C.metal);
}

// 79: coffee machine, 1x1.
{
  const a = art(79, 1, 1);
  a.rect(3, 2, 10, 12, C.screen);
  a.rect(5, 5, 6, 3, C.screenLit);
  a.rect(6, 10, 4, 3, C.metal);
}

// 80: water cooler, 1x1.
{
  const a = art(80, 1, 1);
  a.rect(5, 1, 6, 5, C.glass);
  a.rect(4, 6, 8, 9, C.counter);
  a.rect(6, 9, 4, 2, C.metal);
}

// 81: round cafe table, 2x2.
{
  const a = art(81, 2, 2);
  a.rect(6, 4, 20, 20, C.woodDark);
  a.rect(4, 6, 24, 16, C.woodDark);
  a.rect(8, 8, 16, 12, C.wood);
  a.rect(6, 24, 20, 2, C.shadow);
}

// 82: reception desk, 4x2.
{
  const a = art(82, 4, 2);
  a.rect(0, 8, 64, 20, C.desk);
  a.rect(0, 8, 64, 4, C.deskEdge);
  a.rect(4, 2, 56, 8, C.stone);
  a.rect(4, 2, 56, 2, C.stoneDark);
  a.rect(0, 28, 64, 2, C.shadow);
}

// 83: bookshelf, 1x2.
{
  const a = art(83, 1, 2);
  a.rect(1, 1, 14, 30, C.woodDark);
  a.rect(2, 4, 12, 5, C.wood);
  a.rect(2, 12, 12, 5, C.wood);
  a.rect(2, 20, 12, 5, C.wood);
  a.rect(3, 4, 3, 5, [190, 96, 88]);
  a.rect(8, 12, 3, 5, [92, 128, 184]);
  a.rect(4, 20, 3, 5, [206, 178, 96]);
}

// Anything not drawn stays transparent, so a stray gid shows up as a hole
// rather than quietly rendering someone else's furniture.

// -------------------------------------------------------------------- output

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tilesets = path.join(root, "content", "tilesets");
const assets = path.join(root, "content", "assets");
fs.mkdirSync(tilesets, { recursive: true });
fs.mkdirSync(assets, { recursive: true });

fs.writeFileSync(path.join(tilesets, "office-16.png"), encodePng(pixels, W, H));

// Walls, glass and the solid furniture block movement; the runtime can read
// this with setCollisionByProperty instead of trusting the Collision layer.
const BLOCKING = [
  ...Array.from({ length: 16 }, (_, i) => 16 + i),
  ...Array.from({ length: 16 }, (_, i) => 32 + i),
  64, 67, 68, 69, 70, 71, 72, 73, 76, 77, 78, 79, 80, 81, 82, 83,
];

const tsj = {
  columns: COLS,
  image: "office-16.png",
  imageheight: H,
  imagewidth: W,
  margin: 0,
  name: "office-16",
  spacing: 0,
  tilecount: COLS * ROWS,
  tiledversion: "1.11.0",
  tileheight: TILE,
  tilewidth: TILE,
  type: "tileset",
  version: "1.10",
  tiles: BLOCKING.map((id) => ({ id, properties: [{ name: "collides", type: "bool", value: true }] })),
};
fs.writeFileSync(path.join(tilesets, "office-16.tsj"), `${JSON.stringify(tsj, null, 2)}\n`);

const entry = (id, name, category, tags, tileId, extra = {}) => ({
  id,
  name,
  category,
  tags,
  style: "placeholder",
  tileSize: TILE,
  dimensions: footprints.get(tileId),
  placement: "floor",
  tilesetId: "office-16",
  tileId,
  version: "1",
  ...extra,
});

const block = { collision: { blocking: true } };
const clear = { collision: { blocking: false } };

const catalog = {
  assets: [
    entry("office.desk", "Desk", "furniture", ["desk", "workstation", "monitor"], 64, {
      ...block, interaction: { class: "workstation", capacity: 1 },
    }),
    entry("office.chair", "Task chair", "furniture", ["chair", "seat"], 65, {
      ...clear, interaction: { class: "seat", facing: "up", seatType: "deskchair" },
    }),
    entry("office.stool", "Stool", "furniture", ["stool", "seat"], 66, {
      ...clear, interaction: { class: "seat", facing: "up", seatType: "stool" },
    }),
    entry("office.sofa", "Two-seat sofa", "furniture", ["sofa", "couch", "seat"], 67, block),
    entry("office.armchair", "Armchair", "furniture", ["armchair", "seat"], 68, block),
    entry("office.coffee-table", "Coffee table", "furniture", ["table", "coffee"], 69, block),
    entry("office.plant", "Desk plant", "decoration", ["plant", "greenery"], 70, block),
    entry("office.plant-tall", "Tall plant", "decoration", ["plant", "greenery", "tall"], 71, block),
    entry("office.table.meeting", "Meeting table", "furniture", ["table", "meeting"], 72, block),
    entry("office.table.board", "Boardroom table", "furniture", ["table", "boardroom"], 73, block),
    entry("office.screen", "Wall screen", "furniture", ["screen", "tv", "display"], 74, block),
    entry("office.whiteboard", "Whiteboard", "furniture", ["whiteboard", "board"], 75, block),
    entry("office.counter", "Kitchen counter", "furniture", ["counter", "kitchen"], 76, block),
    entry("office.sink", "Sink counter", "furniture", ["sink", "kitchen", "counter"], 77, block),
    entry("office.fridge", "Fridge", "furniture", ["fridge", "kitchen"], 78, block),
    entry("office.coffee-machine", "Coffee machine", "furniture", ["coffee", "kitchen"], 79, block),
    entry("office.water-cooler", "Water cooler", "furniture", ["water", "cooler"], 80, block),
    entry("office.table.cafe", "Round cafe table", "furniture", ["table", "cafe", "round"], 81, block),
    entry("office.reception-desk", "Reception desk", "furniture", ["reception", "desk"], 82, block),
    entry("office.bookshelf", "Bookshelf", "furniture", ["bookshelf", "shelf"], 83, block),
  ],
};
fs.writeFileSync(path.join(assets, "office-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

console.log(`Wrote ${W}x${H} tileset -> content/tilesets/office-16.png`);
console.log(`Wrote tileset json      -> content/tilesets/office-16.tsj`);
console.log(`Wrote ${catalog.assets.length} catalog assets -> content/assets/office-catalog.json`);
console.log(`\nFloors 1..7 | 15 collision marker | walls 16 + (N=1|E=2|S=4|W=8) | glass 32 + mask | 48/49 thresholds`);
