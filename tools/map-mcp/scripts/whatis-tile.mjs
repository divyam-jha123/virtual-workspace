#!/usr/bin/env node
/**
 * Names whatever is at a tile position in a map: the tile on every tile layer,
 * and any object whose footprint covers that cell.
 *
 * Tiled's own UI will tell you which tileset a tile came from, but not the
 * catalog id you need in order to place it from a script, so this prints both
 * the asset id and the image file.
 *
 *   node tools/map-mcp/scripts/whatis-tile.mjs <x> <y> [mapId]
 *   node tools/map-mcp/scripts/whatis-tile.mjs 3 20
 *   node tools/map-mcp/scripts/whatis-tile.mjs 3 20 maps/office.tmj
 *
 * x and y are TILE coordinates (not pixels), origin top-left.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TILE = 16;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTENT = path.join(root, "content");

const [xArg, yArg, mapArg = "maps/vorkium-hq.tmj"] = process.argv.slice(2);
if (xArg === undefined || yArg === undefined) {
  console.error("usage: whatis-tile.mjs <x> <y> [mapId]");
  process.exit(1);
}
const X = Number(xArg);
const Y = Number(yArg);

const mapPath = path.join(CONTENT, mapArg);
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const W = map.width;
if (X < 0 || Y < 0 || X >= W || Y >= map.height) {
  console.error(`(${X}, ${Y}) is outside this ${W}x${map.height} map`);
  process.exit(1);
}

// gid -> { tileset, image }
const byGid = new Map();
for (const ts of map.tilesets) {
  const id = path.basename(ts.source, ".tsj");
  const tsj = JSON.parse(fs.readFileSync(path.resolve(path.dirname(mapPath), ts.source), "utf8"));
  for (const t of tsj.tiles ?? []) byGid.set(ts.firstgid + t.id, { tileset: id, image: t.image });
}

// image file -> catalog id, so the answer is something you can paste into a script
const byImage = new Map();
for (const f of fs.readdirSync(path.join(CONTENT, "assets"))) {
  if (!f.endsWith("-catalog.json")) continue;
  for (const a of JSON.parse(fs.readFileSync(path.join(CONTENT, "assets", f), "utf8")).assets) {
    byImage.set(`${a.tilesetId}-${a.id.split(".").slice(2).join(".")}.png`, a);
  }
}

const describe = (gid) => {
  const hit = byGid.get(gid);
  if (!hit) return `gid ${gid} — UNRESOLVED`;
  const asset = byImage.get(hit.image);
  return `${asset ? asset.id : "(not in catalog)"}\n        tileset ${hit.tileset}   gid ${gid}   file content/tilesets/${hit.image}`;
};

console.log(`${mapArg} — tile (${X}, ${Y})\n`);

for (const l of map.layers) {
  if (l.type !== "tilelayer") continue;
  const gid = l.data[Y * W + X];
  if (!gid) continue;
  console.log(`  [${l.name}]${l.visible === false ? " (hidden)" : ""}  ${describe(gid)}`);
}

for (const l of map.layers) {
  if (l.type !== "objectgroup") continue;
  for (const o of l.objects) {
    const x0 = Math.floor(o.x / TILE);
    const x1 = Math.floor((o.x + o.width - 1) / TILE);
    // tile objects anchor bottom-left, plain rectangles anchor top-left
    const y1 = Math.floor((o.gid ? o.y - 1 : o.y + o.height - 1) / TILE);
    const y0 = Math.floor((o.gid ? o.y - o.height : o.y) / TILE);
    if (X < x0 || X > x1 || Y < y0 || Y > y1) continue;
    const what = o.gid ? describe(o.gid) : `(rectangle, no tile)`;
    console.log(`  [${l.name}]  object #${o.id} "${o.name || "unnamed"}"${o.class ? ` class=${o.class}` : ""}  ${what}`);
  }
}
