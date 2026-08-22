#!/usr/bin/env node
/**
 * Lays out the reception lobby's seating group per the approved design sketch:
 * a lounge ring centred in the room, open toward the entrance.
 *
 * The sketch is drawn flat - big sofa across the top, two smaller ones facing
 * each other - but the Kenney art is isometric, so "top / left / right" become
 * three edges of a diamond: the back sofa on the upper-left edge, the facing
 * pair on the upper-right and lower-left edges, and the lower-right edge left
 * open because that is the side the entrance is on.
 *
 * The lilac floor is repainted at the same time. It was an off-centre leftover
 * patch, and a centred seating group sitting on an off-centre carpet reads as
 * a mistake; it now fills the room inside a one-tile grey border.
 *
 * Reception desk and receptionist chair are deliberately NOT placed - the kit
 * has no reception-desk sprite, and its only task chair is the wrong colour.
 *
 *   node tools/map-mcp/scripts/lobby-center-lounge.mjs
 *
 * Safe to re-run: it clears its own furniture out of the lobby first.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TILE = 16;
const GID = 0x1fffffff;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MAP = path.join(root, "content", "maps", "vorkium-hq.tmj");
const map = JSON.parse(fs.readFileSync(MAP, "utf8"));
const layer = (n) => map.layers.find((l) => l.name === n);

const W = map.width;
const at = (x, y) => y * W + x;

// --- the room ------------------------------------------------------------
// Interior runs cols 15..32, rows 2..17; the walls sit just outside that.
const COL0 = 15, COL1 = 32, ROW0 = 2, ROW1 = 17;
const CX = ((COL0 + COL1 + 1) / 2) * TILE;   // 384
const CY = ((ROW0 + ROW1 + 1) / 2) * TILE;   // 160

const KENNEY = map.tilesets.find((t) => /kenney-lobby/.test(t.source)).firstgid;
const g = (id) => KENNEY + id;
const SOFA = { SE: g(4), SW: g(5), NE: g(6), NW: g(7) };
const TABLE = g(26), RUG = g(27), PLANT = g(34);

const LILAC = 2531;   // limezu.subway_and_train_station.lilac_tile_1_vers_1
const GREY = 1943;    // limezu.city_terrains.sidewalk_1_9

// --- 1. repaint the floor: lilac inside a one-tile grey border ------------
const ground = layer("Ground").data;
for (let r = ROW0; r <= ROW1; r += 1) {
  for (let c = COL0; c <= COL1; c += 1) {
    const border = r === ROW0 || r === ROW1 || c === COL0 || c === COL1;
    ground[at(c, r)] = border ? GREY : LILAC;
  }
}

// --- 2. clear the old lounge out of the room -----------------------------
const inRoom = (o) => {
  const x = o.x, y = o.gid ? o.y - o.height : o.y;
  return x >= COL0 * TILE && x <= (COL1 + 1) * TILE && y >= ROW0 * TILE && y <= (ROW1 + 1) * TILE;
};
// Match on name as well as position. Anything this script placed is named
// "Lobby ...", and a rerun must be able to clear it even if a previous run left
// it with unusable coordinates - a position-only filter can never find those.
const MINE = (o) => /^Lobby /.test(o.name ?? "");
let removed = 0;
for (const name of ["Furniture", "Decorations"]) {
  const l = layer(name);
  const before = l.objects.length;
  l.objects = l.objects.filter((o) => !(MINE(o) || (inRoom(o) && ((o.gid ?? 0) & GID) >= KENNEY)));
  removed += before - l.objects.length;
}
// Two overlapping sets of seat markers had piled up here from earlier layouts,
// most of them no longer under any sofa. They are rebuilt from the new sofas.
const objects = layer("Objects");
const isSeat = (o) => o.class === "seat" || o.type === "seat";  // this map still uses Tiled's old "type" key
const seatsBefore = objects.objects.length;
objects.objects = objects.objects.filter((o) => !(isSeat(o) && /Lounge seat/.test(o.name ?? "") && (inRoom(o) || o.x == null)));
const staleSeats = seatsBefore - objects.objects.length;

const collision = layer("Collision").data;
const counts = new Map();
for (const v of collision) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
const SOLID = [...counts].sort((a, b) => b[1] - a[1])[0][0];
for (let r = ROW0; r <= ROW1; r += 1) for (let c = COL0; c <= COL1; c += 1) collision[at(c, r)] = 0;

// --- 3. place the new group ----------------------------------------------
// Each sprite is positioned by the centre of the DIAMOND IT STANDS ON, not by
// its bounding box: an isometric sofa is drawn tall so its back can rise above
// the floor, so lining bounding boxes up leaves the furniture visibly off its
// own footprint. GROUND records, per sprite, where that floor centre sits
// inside the image - measured off the artwork rather than guessed.
const GROUND = {
  [SOFA.SE]: [31, 34], [SOFA.SW]: [31, 34], [SOFA.NW]: [31, 34],
  [SOFA.NE]: [31, 50],                     // taller frame, the sofa sits lower in it
  [RUG]: [47, 32], [TABLE]: [23, 41], [PLANT]: [8, 30],
};
let nextId = map.nextobjectid;
const placed = [];
const place = (layerName, name, gid, w, h, cx, cy) => {
  const [gx, gy] = GROUND[gid];
  const x = Math.round(cx - gx), y = Math.round(cy + (h - gy));
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`bad placement for ${name}: (${x}, ${y})`);
  const o = { id: nextId++, name, class: "", gid, x, y, width: w, height: h, rotation: 0, visible: true };
  o.ground = [cx, cy];   // stripped again before saving; the collision pass needs it
  layer(layerName).objects.push(o);
  placed.push(o);
  return o;
};

// The rug and table sit a little up-left of the room's centre, not on it. With
// only three of the four edges occupied the sofas' own centre of mass lands
// up-left, and a rug on the exact room centre reads as having slid out of the
// group toward the open side.
const RUG_X = CX - 16, RUG_Y = CY - 9;
place("Furniture", "Lobby rug", RUG, 96, 64, RUG_X, RUG_Y);
place("Decorations", "Lobby coffee table", TABLE, 48, 48, RUG_X, RUG_Y);

// Three sofas on three edges of the rug, each pushed out far enough to clear
// its corner. The sofas stay symmetric about the room centre, so the group as
// a whole still reads as centred.
const OUT_X = 56, OUT_Y = 32;
const sofas = [
  place("Decorations", "Lobby sofa back", SOFA.SW, 64, 48, CX - OUT_X, CY - OUT_Y),
  place("Decorations", "Lobby sofa right", SOFA.SE, 64, 48, CX + OUT_X, CY - OUT_Y),
  place("Decorations", "Lobby sofa left", SOFA.NE, 64, 64, CX - OUT_X, CY + OUT_Y),
];

// Four potted plants, one per corner of the lilac floor.
for (const [c, r] of [[COL0 + 1, ROW0 + 2], [COL1 - 1, ROW0 + 2], [COL0 + 1, ROW1 - 1], [COL1 - 1, ROW1 - 1]]) {
  place("Decorations", "Lobby plant", PLANT, 16, 32, c * TILE + 8, r * TILE + 14);
}

// --- 4. collision + seat markers -----------------------------------------
// A sofa's footprint is two tile rows deep. The back row is solid so nobody
// walks through the backrest; the cushion row stays clear and carries three
// 1x1 seat markers, which is the same split the rest of the map uses.
let seatNo = 0;
for (const s of sofas) {
  const [gcx, gcy] = s.ground;
  const baseRow = Math.floor(gcy / TILE) + 1;   // cushions sit one row in front of the footprint centre
  const col0 = Math.floor(gcx / TILE) - 1;      // three seats, centred on the sofa
  const upFacing = s.gid === SOFA.NE || s.gid === SOFA.NW;
  const backRow = upFacing ? baseRow + 1 : baseRow - 1;
  for (let d = 0; d < 3; d += 1) {
    collision[at(col0 + d, backRow)] = SOLID;
    collision[at(col0 + d, baseRow)] = 0;
    objects.objects.push({
      id: nextId++, name: `Lounge seat ${(seatNo += 1)}`, type: "seat",
      x: (col0 + d) * TILE, y: baseRow * TILE, width: TILE, height: TILE,
      rotation: 0, visible: true,
      properties: [
        { name: "facing", type: "string", value: upFacing ? "up" : "down" },
        { name: "seatType", type: "string", value: "sofa" },
      ],
    });
  }
}
// Plants and the coffee table are obstacles, not seats.
for (const o of placed) {
  if (o.gid !== PLANT && o.gid !== TABLE) continue;
  const [gcx, gcy] = o.ground;
  collision[at(Math.floor(gcx / TILE), Math.floor(gcy / TILE))] = SOLID;
}
for (const o of placed) delete o.ground;   // scratch field, not part of the Tiled format

map.nextobjectid = nextId;
fs.writeFileSync(MAP, `${JSON.stringify(map, null, 1)}\n`);
console.log(`cleared ${removed} old lobby object(s) and ${staleSeats} stale seat marker(s)`);
console.log(`placed rug, coffee table, 3 sofas, 4 plants and ${seatNo} seats around (${CX}, ${CY})`);
