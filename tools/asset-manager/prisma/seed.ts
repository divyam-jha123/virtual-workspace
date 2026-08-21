import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { createContext } from "../src/context.js";
import { prisma } from "../src/db.js";
import { parseTsx } from "../src/import/tsx.js";
import type { IngestAsset, IngestTileset } from "../src/import/ingest.js";
import { ingest } from "../src/import/ingest.js";

const contentDir = config.contentDir;
const tilesDir = path.join(contentDir, "tiles");
const tilesetsDir = path.join(contentDir, "tilesets");
const propsDir = path.join(tilesDir, "props");

async function readBytes(p: string): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(p));
}

async function imagesFromDir(dir: string): Promise<Map<string, Uint8Array>> {
  const map = new Map<string, Uint8Array>();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return map;
  }
  for (const name of entries) {
    if (name.toLowerCase().endsWith(".png")) map.set(name, await readBytes(path.join(dir, name)));
  }
  return map;
}

/** office-props tile ids, from content/tilesets/office-props.tsx. */
const desk = 21;
const chairLeft = 5, chairDown = 6, chairUp = 7, chairRight = 8;
const plant = 12, whiteboard = 20, lockers = 9, printer = 3, waterCooler = 17;
const monitorCode = 2, monitorChart = 1, cabinet = 18, fridge = 4, receptionDesk = 24, elevator = 15;

const propAssets: IngestAsset[] = [
  { name: "Office desk", slug: "office.desk", tilesetKey: "office-props", tileId: desk, category: "furniture", subcategory: "desk", style: "office", widthTiles: 2, heightTiles: 2, placement: "floor", collision: { blocking: true }, interaction: { class: "workstation", capacity: 1 }, tags: ["desk", "table", "workstation", "office"], type: "OBJECT" },
  { name: "Reception desk", slug: "office.reception-desk", tilesetKey: "office-props", tileId: receptionDesk, category: "furniture", subcategory: "desk", style: "office", widthTiles: 3, heightTiles: 2, placement: "floor", collision: { blocking: true }, tags: ["desk", "reception", "office"], type: "OBJECT" },
  { name: "Swivel chair (left)", slug: "office.chair-left", tilesetKey: "office-props", tileId: chairLeft, category: "furniture", subcategory: "chair", widthTiles: 1, heightTiles: 1, collision: { blocking: false }, interaction: { class: "seat", facing: "left", seatType: "deskchair" }, tags: ["chair", "seat"], type: "OBJECT" },
  { name: "Swivel chair (right)", slug: "office.chair-right", tilesetKey: "office-props", tileId: chairRight, category: "furniture", subcategory: "chair", widthTiles: 1, heightTiles: 1, collision: { blocking: false }, interaction: { class: "seat", facing: "right", seatType: "deskchair" }, tags: ["chair", "seat"], type: "OBJECT" },
  { name: "Swivel chair (up)", slug: "office.chair-up", tilesetKey: "office-props", tileId: chairUp, category: "furniture", subcategory: "chair", widthTiles: 1, heightTiles: 1, collision: { blocking: false }, interaction: { class: "seat", facing: "up", seatType: "deskchair" }, tags: ["chair", "seat"], type: "OBJECT" },
  { name: "Swivel chair (down)", slug: "office.chair-down", tilesetKey: "office-props", tileId: chairDown, category: "furniture", subcategory: "chair", widthTiles: 1, heightTiles: 1, collision: { blocking: false }, interaction: { class: "seat", facing: "down", seatType: "deskchair" }, tags: ["chair", "seat"], type: "OBJECT" },
  { name: "Fiddle-leaf plant", slug: "office.plant", tilesetKey: "office-props", tileId: plant, category: "decoration", widthTiles: 1, heightTiles: 1, placement: "floor", collision: { blocking: true }, tags: ["plant", "greenery", "decoration"], type: "ENVIRONMENT" },
  { name: "Whiteboard", slug: "office.whiteboard", tilesetKey: "office-props", tileId: whiteboard, category: "furniture", widthTiles: 2, heightTiles: 2, placement: "wall", collision: { blocking: false }, tags: ["whiteboard", "board"], type: "OBJECT" },
  { name: "Lockers", slug: "office.lockers", tilesetKey: "office-props", tileId: lockers, category: "furniture", subcategory: "storage", widthTiles: 1, heightTiles: 1, collision: { blocking: true }, tags: ["lockers", "storage"], type: "OBJECT" },
  { name: "Printer", slug: "office.printer", tilesetKey: "office-props", tileId: printer, category: "equipment", widthTiles: 1, heightTiles: 1, collision: { blocking: true }, tags: ["printer", "equipment"], type: "OBJECT" },
  { name: "Water cooler", slug: "office.water-cooler", tilesetKey: "office-props", tileId: waterCooler, category: "equipment", widthTiles: 1, heightTiles: 1, collision: { blocking: true }, tags: ["water", "cooler"], type: "OBJECT" },
  { name: "Monitor (code)", slug: "office.monitor-code", tilesetKey: "office-props", tileId: monitorCode, category: "equipment", widthTiles: 1, heightTiles: 1, placement: "overlay", collision: { blocking: false }, tags: ["monitor", "screen", "display"], type: "OBJECT" },
  { name: "Monitor (chart)", slug: "office.monitor-chart", tilesetKey: "office-props", tileId: monitorChart, category: "equipment", widthTiles: 1, heightTiles: 1, placement: "overlay", collision: { blocking: false }, tags: ["monitor", "screen", "display"], type: "OBJECT" },
  { name: "Filing cabinet", slug: "office.cabinet", tilesetKey: "office-props", tileId: cabinet, category: "furniture", subcategory: "storage", widthTiles: 1, heightTiles: 1, collision: { blocking: true }, tags: ["cabinet", "storage"], type: "OBJECT" },
  { name: "Fridge", slug: "office.fridge", tilesetKey: "office-props", tileId: fridge, category: "appliance", widthTiles: 1, heightTiles: 2, collision: { blocking: true }, tags: ["fridge", "kitchen"], type: "OBJECT" },
  { name: "Elevator", slug: "office.elevator", tilesetKey: "office-props", tileId: elevator, category: "structure", widthTiles: 2, heightTiles: 2, placement: "wall", collision: { blocking: true }, tags: ["elevator", "lift"], type: "BUILDING" },
  // A couple of grid-tileset tiles, for browsability (usually placed via place_tiles).
  { name: "Office floor tile", slug: "office.floor", tilesetKey: "office-floors", tileId: 0, category: "floor", widthTiles: 1, heightTiles: 1, placement: "floor", collision: { blocking: false }, tags: ["floor", "ground"], type: "TILESET" },
  { name: "Office wall tile", slug: "office.wall", tilesetKey: "office-walls", tileId: 0, category: "wall", widthTiles: 1, heightTiles: 1, placement: "wall", collision: { blocking: true }, tags: ["wall", "partition"], type: "TILESET" },
];

/**
 * The sample art is NOT in the repo — `content/tiles/` is gitignored because the
 * pack shipped with no license (see content/tiles/ATTRIBUTION.md). So this seed
 * only works for someone who already has that art on disk. Say so plainly
 * instead of dying on an ENOENT stack trace.
 */
async function assertSampleArtPresent(): Promise<void> {
  const required = [
    path.join(tilesetsDir, "office-props.tsx"),
    path.join(tilesetsDir, "office-floors.tsx"),
    path.join(tilesetsDir, "office-walls.tsx"),
    path.join(tilesDir, "office-floors.png"),
    path.join(tilesDir, "office-walls.png"),
    propsDir,
  ];
  const missing: string[] = [];
  for (const p of required) {
    try {
      await fs.stat(p);
    } catch {
      missing.push(path.relative(contentDir, p));
    }
  }
  if (missing.length === 0) return;

  throw new Error(
    [
      "The sample art this seed needs is not present.",
      "",
      `Missing under content/: ${missing.join(", ")}`,
      "",
      "This repo ships code, not art — content/tiles/ is gitignored because the sample",
      "pack came with no license file. The seed is only for someone who already has it.",
      "",
      "To load your own art instead, skip the seed and use the importer:",
      "  1. start the stack, open http://localhost:3301/import",
      "  2. drop in a .zip that contains a .tsx or .tsj (a zip of bare PNGs makes no tileset)",
      "  3. commit it, then mint assets in the tileset inspector",
      "",
      "See the README section \"Designing maps and art\".",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const ctx = createContext(config, prisma);
  await assertSampleArtPresent();

  const propsXml = await fs.readFile(path.join(tilesetsDir, "office-props.tsx"), "utf8");
  const floorsXml = await fs.readFile(path.join(tilesetsDir, "office-floors.tsx"), "utf8");
  const wallsXml = await fs.readFile(path.join(tilesetsDir, "office-walls.tsx"), "utf8");

  const propImages = await imagesFromDir(propsDir);
  const gridImages = new Map<string, Uint8Array>();
  gridImages.set("office-floors.png", await readBytes(path.join(tilesDir, "office-floors.png")));
  gridImages.set("office-walls.png", await readBytes(path.join(tilesDir, "office-walls.png")));

  const tilesets: IngestTileset[] = [
    { spec: { ...parseTsx(floorsXml), name: "office-floors" }, tsxXml: floorsXml, images: gridImages, key: "office-floors" },
    { spec: { ...parseTsx(wallsXml), name: "office-walls" }, tsxXml: wallsXml, images: gridImages, key: "office-walls" },
    { spec: { ...parseTsx(propsXml), name: "office-props" }, tsxXml: propsXml, images: propImages, key: "office-props" },
  ];

  const result = await ingest(ctx, {
    pack: {
      name: "Office Interior",
      slug: "office-interior",
      description: "Little Bits office tileset — floors, walls, and ~28 interior props, cropped to Tiled tiles. Seeded from the repo's content/tiles.",
      source: "Little Bits Office tileset",
      author: "unknown (see content/tiles/ATTRIBUTION.md)",
    },
    license: {
      name: "Little Bits Office tileset (license unconfirmed)",
      licenseName: "Unconfirmed",
      notes: "Shipped with no license file, author, or URL. Confirm terms before shipping publicly. See content/tiles/ATTRIBUTION.md.",
      attributionRequired: true,
      commercialUseAllowed: false,
      redistributionAllowed: false,
    },
    tilesets,
    assets: propAssets,
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded pack "${result.packSlug}": ${result.tilesetKeys.length} tilesets, ${result.assetSlugs.length} assets.`);
  for (const w of result.warnings) console.log(`  ⚠ ${w}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
