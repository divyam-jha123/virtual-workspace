#!/usr/bin/env node
/**
 * Renders a 16px-grid-aligned subset of the Kenney Furniture Kit for use in the
 * reception lobby.
 *
 * The kit's sprites are arbitrary sizes (a sofa is 141x141) and far larger than
 * this project's 16px tiles, so they cannot be placed as shipped. This scales
 * the pieces the lobby needs by ONE shared factor — chosen so a lounge sofa
 * comes out three tiles wide — and then pads each result up to a whole number
 * of tiles. Using a single factor is the point: scaling each piece to fit its
 * own slot would leave the chairs and sofas out of proportion with each other.
 *
 * Padding anchors the sprite bottom-centre, because Tiled draws a tile object
 * from its bottom-left, so that is what makes the footprint sit where the
 * furniture visually stands.
 *
 * Kenney is CC0, so these derived sprites are fine to keep in the repo.
 *
 *   node tools/map-mcp/scripts/make-kenney-lobby-set.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const KIT = path.join(root, "content", "tilesets", "kenney-furniture");
const SRC = path.join(KIT, "isometric");
const OUT = path.join(KIT, "lobby16");

/** name -> which rotations we need. SE/SW show the seat, NE/NW show the back. */
const PIECES = {
  loungeSofa: ["SE", "SW", "NE", "NW"],
  loungeDesignSofa: ["SE", "SW", "NE", "NW"],
  loungeDesignSofaCorner: ["SE", "SW", "NE", "NW"],
  loungeDesignChair: ["SE", "SW", "NE", "NW"],
  loungeSofaCorner: ["SE", "NW"],
  loungeSofaLong: ["SE", "NE"],
  loungeChair: ["SE", "SW", "NE", "NW"],
  tableCoffee: ["SE"],
  sideTableDrawers: ["SE"],
  tableCoffeeGlass: ["SE"],
  rugRectangle: ["SE"],
  rugRounded: ["SE"],
  rugSquare: ["SE"],
  desk: ["SE"],
  deskCorner: ["SE"],
  chairDesk: ["NE"],           // receptionist sits with their back to us
  computerScreen: ["SE"],
  pottedPlant: ["SE"],
  plantSmall1: ["SE"],
  bookcaseClosed: ["SE"],
  sideTable: ["SE"],
  lampSquareFloor: ["SE"],
  trashcan: ["SE"],
};

fs.mkdirSync(OUT, { recursive: true });

// One shared factor: a loungeSofa becomes exactly 3 tiles wide.
const py = `
import sys, json, os
from PIL import Image
src, out, pieces = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
base = Image.open(os.path.join(src, "loungeSofa_SE.png")).size[0]
F = 48 / base
made = []
for name, rots in pieces.items():
    for rot in rots:
        p = os.path.join(src, f"{name}_{rot}.png")
        if not os.path.exists(p):
            print(f"  MISSING {name}_{rot}"); continue
        im = Image.open(p).convert("RGBA")
        sw, sh = max(1, round(im.width * F)), max(1, round(im.height * F))
        im = im.resize((sw, sh), Image.LANCZOS)
        tw, th = -(-sw // 16), -(-sh // 16)          # round up to whole tiles
        canvas = Image.new("RGBA", (tw * 16, th * 16), (0, 0, 0, 0))
        canvas.alpha_composite(im, ((tw * 16 - sw) // 2, th * 16 - sh))  # bottom-centre
        f = f"kenney-{name}-{rot}.png"
        canvas.save(os.path.join(out, f))
        made.append((f, tw, th))
print(json.dumps(made))
`;
const res = execFileSync("python3", ["-c", py, SRC, OUT, JSON.stringify(PIECES)], { encoding: "utf8" });
const made = JSON.parse(res.trim().split("\n").pop());

const tiles = made.map(([file, tw, th], i) => ({
  id: i,
  image: `lobby16/${file}`,
  imagewidth: tw * 16,
  imageheight: th * 16,
}));
fs.writeFileSync(
  path.join(KIT, "kenney-lobby.tsj"),
  `${JSON.stringify({
    columns: 0,
    grid: { orientation: "orthogonal", width: 16, height: 16 },
    margin: 0, name: "kenney-lobby", spacing: 0,
    tilecount: tiles.length, tiledversion: "1.11.0",
    tileheight: 16, tilewidth: 16, type: "tileset", version: "1.10", tiles,
  }, null, 2)}\n`,
);

console.log(`kenney-lobby.tsj — ${tiles.length} pieces, all whole tiles:`);
for (const [f, tw, th] of made) console.log(`   ${tw}x${th}  ${f}`);
