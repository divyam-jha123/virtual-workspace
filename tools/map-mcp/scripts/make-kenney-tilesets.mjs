#!/usr/bin/env node
/**
 * Builds Tiled tilesets for the Kenney Furniture Kit so it can be used by hand
 * in Tiled.
 *
 * These are collection-of-images tilesets: every sprite keeps its own size,
 * which matters here because Kenney's renders are arbitrary pixel sizes
 * (109x212, 83x83, 42x68 ...) and none of them are multiples of 16. They will
 * not snap to this project's 16px grid — see the README written alongside.
 *
 * Two tilesets are produced, because the kit ships two different projections:
 *   kenney-furniture-side.tsj        140 side-elevation sprites
 *   kenney-furniture-isometric.tsj   560 isometric sprites (4 rotations each)
 *
 *   node tools/map-mcp/scripts/make-kenney-tilesets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = path.join(root, "content", "tilesets", "kenney-furniture");

/** Width/height straight out of the PNG's IHDR — no decoding needed. */
function pngSize(file) {
  const head = Buffer.alloc(26);
  const fd = fs.openSync(file, "r");
  try {
    if (fs.readSync(fd, head, 0, 26, 0) < 26) return null;
  } finally {
    fs.closeSync(fd);
  }
  if (head.readUInt32BE(0) !== 0x89504e47 || head.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function build(folder, name) {
  const dir = path.join(DIR, folder);
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".png")).sort();
  const tiles = [];
  for (const file of files) {
    const size = pngSize(path.join(dir, file));
    if (!size) continue;
    tiles.push({
      id: tiles.length,
      image: `${folder}/${file}`,
      imagewidth: size.width,
      imageheight: size.height,
    });
  }
  const tsj = {
    columns: 0,
    grid: { orientation: "orthogonal", width: 16, height: 16 },
    margin: 0,
    name,
    spacing: 0,
    tilecount: tiles.length,
    tiledversion: "1.11.0",
    tileheight: 16,
    tilewidth: 16,
    type: "tileset",
    version: "1.10",
    tiles,
  };
  const out = path.join(DIR, `${name}.tsj`);
  fs.writeFileSync(out, `${JSON.stringify(tsj, null, 2)}\n`);
  const spans = tiles.map((t) => `${t.imagewidth}x${t.imageheight}`);
  const offGrid = tiles.filter((t) => t.imagewidth % 16 || t.imageheight % 16).length;
  console.log(`${name}.tsj  ${tiles.length} sprites  (${offGrid} not multiples of 16px)`);
  return tiles.length;
}

build("side", "kenney-furniture-side");
build("isometric", "kenney-furniture-isometric");
