#!/usr/bin/env node
/**
 * Import a LimeZu "Modern Exteriors" pack into the map-mcp workspace.
 *
 * The pack ships every object twice: once baked into a theme atlas, and once as
 * a folder of per-object PNGs ("Singles"). The singles are what we want. An
 * asset in this project is ONE tile whose image is drawn at `dimensions * 16`
 * pixels (see MapService.placeAsset), so a 2x3 desk has to be a single 32x48
 * tile — exactly what a single is. Slicing the atlas into 16px cells instead
 * would give us a thousand fragments and no object names.
 *
 * Per theme this writes:
 *   content/tilesets/limezu-<theme>.tsj      collection-of-images tileset
 *   content/tilesets/limezu-<theme>-*.png    one PNG per object, flat
 *   content/assets/limezu-<theme>-catalog.json
 *
 * The PNGs are copied flat because the validator resolves a tileset's image
 * references as `tilesets/<basename>` (map-service.ts `imageReferences`).
 *
 *   node tools/map-mcp/scripts/import-limezu.mjs --themes office,city_props
 *   node tools/map-mcp/scripts/import-limezu.mjs --all --dry-run
 *
 * Flags:
 *   --themes a,b   themes to import (default: office, city_props, garden,
 *                  terrains_and_fences); matched loosely against folder names
 *   --all          every theme in the pack
 *   --list         print the available themes and exit
 *   --pack <dir>   pack root (default: <map-mcp>/modernexteriors-win)
 *   --out <dir>    workspace root (default: <repo>/content)
 *   --tile-size N  which size variant of the pack to read (default: 16)
 *   --max-span N   skip objects wider or taller than N tiles (default: 24)
 *   --dry-run      report what would be written, write nothing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP_MCP = path.resolve(HERE, "..");
const REPO = path.resolve(MAP_MCP, "../..");

const DEFAULT_THEMES = ["office", "city_props", "garden", "terrains_and_fences"];

// ---------------------------------------------------------------------------
// args

function parseArgs(argv) {
  const args = { themes: null, all: false, list: false, pack: null, out: null, tileSize: 16, maxSpan: 24, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) fail(`${flag} needs a value`);
      i += 1;
      return next;
    };
    if (flag === "--themes") args.themes = value().split(",").map((t) => t.trim()).filter(Boolean);
    else if (flag === "--all") args.all = true;
    else if (flag === "--list") args.list = true;
    else if (flag === "--pack") args.pack = path.resolve(value());
    else if (flag === "--out") args.out = path.resolve(value());
    else if (flag === "--tile-size") args.tileSize = Number(value());
    else if (flag === "--max-span") args.maxSpan = Number(value());
    else if (flag === "--dry-run") args.dryRun = true;
    else fail(`Unknown flag: ${flag}`);
  }
  return args;
}

function fail(message) {
  console.error(`import-limezu: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// pack discovery

/** The theme-sorted singles folders, keyed by a slug derived from the folder name. */
function discoverThemes(packRoot, tileSize) {
  const sorter = path.join(packRoot, `Modern_Exteriors_${tileSize}x${tileSize}`, `ME_Theme_Sorter_${tileSize}x${tileSize}`);
  if (!fs.existsSync(sorter)) {
    fail(`No theme folder at ${sorter}. Point --pack at the unzipped pack root (the folder holding Modern_Exteriors_16x16/).`);
  }
  const themes = new Map();
  for (const entry of fs.readdirSync(sorter, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = /^\d+_(.+)_Singles_\d+x\d+$/.exec(entry.name);
    if (!match) continue;
    const slug = match[1].toLowerCase();
    themes.set(slug, { slug, label: match[1].replace(/_/g, " "), dir: path.join(sorter, entry.name) });
  }
  if (themes.size === 0) fail(`No "*_Singles_${tileSize}x${tileSize}" folders under ${sorter}.`);
  return themes;
}

/** Loose match so `--themes office` finds `16_Office_Singles_16x16`. */
function resolveTheme(themes, wanted) {
  const key = wanted.toLowerCase().replace(/[\s-]/g, "_");
  if (themes.has(key)) return themes.get(key);
  const partial = [...themes.values()].filter((theme) => theme.slug.includes(key));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) fail(`"${wanted}" matches ${partial.map((t) => t.slug).join(", ")} — be more specific.`);
  return fail(`No theme matching "${wanted}". Run with --list to see them.`);
}

// ---------------------------------------------------------------------------
// classification
//
// Everything below is a guess made from the object's filename. It only has to
// be good enough for search_assets to rank sensibly and for collision to start
// in roughly the right place — a wrong call is one field to edit in the
// catalog, and the catalog is regenerated from here, so fix the rule not the file.

const CATEGORY_RULES = [
  [/\b(tree|bush|sprout|flower|plant|grass|hedge|leaf|leaves|log|palm|cactus|mushroom)\b/, "nature"],
  [/\b(car|truck|van|bus|bike|bicycle|motorbike|scooter|ambulance|police_car|taxi|train|tram|boat)\b/, "vehicle"],
  [/\b(building|house|villa|roof|wall|floor|window|door|balcony|stair|stairs|fence|gate|awning|pillar|column|shutter)\b/, "structure"],
  [/\b(desk|table|chair|stool|sofa|couch|bench|bed|shelf|cabinet|counter|locker|wardrobe|drawer)\b/, "furniture"],
  [/\b(road|path|pavement|sidewalk|terrain|water|sand|dirt|tile|pavimentation|crosswalk|parking_line)\b/, "terrain"],
];

function categoryOf(tokens) {
  const text = ` ${tokens.join(" ")} `;
  for (const [pattern, category] of CATEGORY_RULES) if (pattern.test(text)) return category;
  return "decoration";
}

/** Where the sprite lives in the stack — wall art must not be dropped on the floor. */
function placementOf(tokens, category) {
  const text = ` ${tokens.join(" ")} `;
  if (/\b(roof|antenna|chimney|air_duct|skylight)\b/.test(text)) return "overlay";
  if (/\b(window|balcony|shutter|awning|sign|banner|billboard|graffiti|poster|clock)\b/.test(text)) return "wall";
  if (category === "terrain") return "floor";
  return "floor";
}

/** Blocking by default for anything solid; flat ground art and wall art are not. */
function blockingOf(tokens, category, placement) {
  const text = ` ${tokens.join(" ")} `;
  if (placement !== "floor") return false;
  if (category === "terrain") return /\b(water|deep_water|hole|cliff)\b/.test(text);
  if (/\b(rug|carpet|mat|shadow|line|marking|stain|puddle|manhole|grate|leaves)\b/.test(text)) return false;
  return category !== "decoration" || /\b(barrel|crate|box|bin|trash|hydrant|statue|fountain|atm|vending|pole|lamp)\b/.test(text);
}

/**
 * Gameplay class, only where the name is unambiguous. An asset with no
 * interaction is still placeable — it is just scenery until someone sets a
 * class on the placed object.
 */
function interactionOf(tokens) {
  const text = ` ${tokens.join(" ")} `;
  if (/\bdesk\b/.test(text) && !/\b(lamp|chair|drawer)\b/.test(text)) return { class: "workstation", capacity: 1 };
  if (/\b(sofa|couch)\b/.test(text)) return { class: "seat", facing: "down", seatType: "sofa" };
  if (/\bstool\b/.test(text)) return { class: "seat", facing: "down", seatType: "stool" };
  if (/\b(chair|bench)\b/.test(text)) return { class: "seat", facing: "down", seatType: "chair" };
  if (/\bdoor\b/.test(text) && !/\b(doormat|door_mat)\b/.test(text)) return { class: "door", locked: false };
  return undefined;
}

const NOISE_TAGS = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "vers", "modular", "single", "singles"]);

// ---------------------------------------------------------------------------
// png

/** Width/height straight from the IHDR — the pixels are copied untouched. */
function readPngSize(file) {
  const header = Buffer.alloc(26);
  const fd = fs.openSync(file, "r");
  try {
    if (fs.readSync(fd, header, 0, 26, 0) < 26) return null;
  } finally {
    fs.closeSync(fd);
  }
  if (header.readUInt32BE(0) !== 0x89504e47 || header.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------
// import

function importTheme(theme, options) {
  const { tileSize, maxSpan, tilesetsDir, assetsDir, dryRun } = options;
  const files = fs
    .readdirSync(theme.dir)
    .filter((file) => file.toLowerCase().endsWith(".png"))
    .sort();

  const tilesetId = `limezu-${theme.slug}`;
  const tiles = [];
  const assets = [];
  const skipped = { offGrid: 0, oversize: 0, unreadable: 0 };
  const seen = new Set();

  for (const file of files) {
    const source = path.join(theme.dir, file);
    const size = readPngSize(source);
    if (!size) {
      skipped.unreadable += 1;
      continue;
    }
    if (size.width % tileSize !== 0 || size.height % tileSize !== 0) {
      // Tiled scales a tile object to dimensions*tileSize, so an off-grid
      // sprite would render stretched. Better to leave it out than to lie.
      skipped.offGrid += 1;
      continue;
    }
    const width = size.width / tileSize;
    const height = size.height / tileSize;
    if (width > maxSpan || height > maxSpan) {
      skipped.oversize += 1;
      continue;
    }

    const bare = file.replace(/\.png$/i, "").replace(/^ME_Singles_.*?_\d+x\d+_/, "");
    let slug = bare.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (seen.has(slug)) {
      let n = 2;
      while (seen.has(`${slug}_${n}`)) n += 1;
      slug = `${slug}_${n}`;
    }
    seen.add(slug);

    const tokens = slug.split("_").filter(Boolean);
    const category = categoryOf(tokens);
    const placement = placementOf(tokens, category);
    const image = `${tilesetId}-${slug}.png`;
    const tileId = tiles.length;

    tiles.push({ id: tileId, image, imagewidth: size.width, imageheight: size.height });
    assets.push({
      id: `limezu.${theme.slug}.${slug}`,
      name: bare.replace(/_/g, " "),
      category,
      subcategory: theme.slug,
      tags: [...new Set([...tokens.filter((t) => !NOISE_TAGS.has(t)), theme.slug, "limezu"])],
      style: "modern-exteriors",
      tileSize,
      dimensions: { width, height },
      placement,
      tilesetId,
      tileId,
      collision: { blocking: blockingOf(tokens, category, placement) },
      ...(interactionOf(tokens) ? { interaction: interactionOf(tokens) } : {}),
      source: {
        author: "LimeZu",
        license: "Commercial, per-buyer (itch.io). Not redistributable.",
        url: "https://limezu.itch.io/modernexteriors",
      },
    });

    if (!dryRun) fs.copyFileSync(source, path.join(tilesetsDir, image));
  }

  const tsj = {
    columns: 0,
    grid: { orientation: "orthogonal", width: tileSize, height: tileSize },
    margin: 0,
    name: tilesetId,
    spacing: 0,
    tilecount: tiles.length,
    tiledversion: "1.10.2",
    tileheight: tileSize,
    tilewidth: tileSize,
    type: "tileset",
    version: "1.10",
    tiles,
  };

  const catalog = { assets };

  if (!dryRun) {
    fs.writeFileSync(path.join(tilesetsDir, `${tilesetId}.tsj`), `${JSON.stringify(tsj, null, 2)}\n`);
    fs.writeFileSync(path.join(assetsDir, `${tilesetId}-catalog.json`), `${JSON.stringify(catalog, null, 2)}\n`);
  }

  return { tilesetId, count: tiles.length, skipped, assets };
}

// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packRoot = args.pack ?? path.join(MAP_MCP, "modernexteriors-win");
  const workspace = args.out ?? path.join(REPO, "content");
  const themes = discoverThemes(packRoot, args.tileSize);

  if (args.list) {
    console.log(`Themes in ${packRoot} (${args.tileSize}px):`);
    for (const theme of [...themes.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
      const count = fs.readdirSync(theme.dir).filter((f) => f.toLowerCase().endsWith(".png")).length;
      console.log(`  ${theme.slug.padEnd(24)} ${String(count).padStart(4)} objects`);
    }
    return;
  }

  const wanted = args.all ? [...themes.keys()] : (args.themes ?? DEFAULT_THEMES);
  const selected = args.all ? [...themes.values()] : wanted.map((name) => resolveTheme(themes, name));

  const tilesetsDir = path.join(workspace, "tilesets");
  const assetsDir = path.join(workspace, "assets");
  for (const dir of [tilesetsDir, assetsDir]) {
    if (!fs.existsSync(dir)) fail(`No such workspace directory: ${dir}. Point --out at the repo's content/ folder.`);
  }

  console.log(`Pack:      ${packRoot} (${args.tileSize}px)`);
  console.log(`Workspace: ${workspace}${args.dryRun ? "  [dry run]" : ""}\n`);

  let total = 0;
  const categories = new Map();
  for (const theme of selected) {
    const result = importTheme(theme, { ...args, tilesetsDir, assetsDir, dryRun: args.dryRun });
    total += result.count;
    for (const asset of result.assets) categories.set(asset.category, (categories.get(asset.category) ?? 0) + 1);
    const skips = Object.entries(result.skipped)
      .filter(([, n]) => n > 0)
      .map(([reason, n]) => `${n} ${reason}`)
      .join(", ");
    console.log(`  ${result.tilesetId.padEnd(28)} ${String(result.count).padStart(4)} assets${skips ? `  (skipped ${skips})` : ""}`);
  }

  console.log(`\n${total} assets across ${selected.length} tileset(s).`);
  console.log(`By category: ${[...categories].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", ")}`);
  if (args.dryRun) console.log("\nNothing written (--dry-run).");
  else console.log(`\nWrote content/tilesets/limezu-*.tsj + PNGs and content/assets/limezu-*-catalog.json.\nRestart the MCP server (it scans the workspace at startup) and call get_project_info.`);
}

main();
