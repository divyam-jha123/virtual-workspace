import type { OfficeMapData } from "./schema";
import { PROP_SIZE_PX, PROP_COLLISION_BOX, DECORATION_PROPS, type PropType } from "./props";
import { TILE_SIZE } from "./tileset";

/**
 * The movement code talks to the map only through this narrow interface, so
 * the Player/collision logic is fully decoupled from how the tilemap is
 * represented. Wire any map to it by implementing `isWalkable`.
 */
export interface CollisionMap {
  readonly width: number;
  readonly height: number;
  /** true when a tile can be stood on (in bounds and not blocked). */
  isWalkable(tileX: number, tileY: number): boolean;
}

/** A tile counts as blocked by furniture only if the sprite covers at least
 *  this fraction of it — so collision hugs the visual and never bleeds into a
 *  neighbouring walkable tile (the old rounded footprint over-blocked, which
 *  is what made corners of sofas/chairs feel sticky). */
const COLLISION_COVERAGE = 0.5;

/** Tiles a furniture sprite (anchored bottom-center on tx,ty) covers by at
 *  least `minCoverage` of the tile's area. */
export function propCoverageTiles(
  prop: PropType,
  tx: number,
  ty: number,
  minCoverage: number,
): Array<[number, number]> {
  const [w, h] = PROP_SIZE_PX[prop];
  const box = PROP_COLLISION_BOX[prop];
  // Sprite is anchored bottom-center; map the (optional) solid box into world px.
  const spriteLeft = (tx + 0.5) * TILE_SIZE - w / 2;
  const spriteTop = (ty + 1) * TILE_SIZE - h;
  const left = box ? spriteLeft + box.x : spriteLeft;
  const right = box ? left + box.w : spriteLeft + w;
  const top = box ? spriteTop + box.y : spriteTop;
  const bottom = box ? top + box.h : (ty + 1) * TILE_SIZE;

  const tiles: Array<[number, number]> = [];
  const cell = TILE_SIZE * TILE_SIZE;
  for (let cy = Math.floor(top / TILE_SIZE); cy <= Math.floor((bottom - 1e-4) / TILE_SIZE); cy++) {
    for (let cx = Math.floor(left / TILE_SIZE); cx <= Math.floor((right - 1e-4) / TILE_SIZE); cx++) {
      const ox = Math.min(right, (cx + 1) * TILE_SIZE) - Math.max(left, cx * TILE_SIZE);
      const oy = Math.min(bottom, (cy + 1) * TILE_SIZE) - Math.max(top, cy * TILE_SIZE);
      if ((ox * oy) / cell >= minCoverage) tiles.push([cx, cy]);
    }
  }
  return tiles;
}

/**
 * Sittable furniture doesn't block — you step onto a chair/sofa to sit (the
 * sit trigger fires on-tile), so these tiles must be walkable. Pods aren't
 * here: they block only their central desk (via PROP_COLLISION_BOX), leaving
 * their chairs walkable.
 */
const WALKABLE_FURNITURE = new Set<PropType>([
  "chair",
  "stool",
  "sofa",
  "sofaV",
  "sofaCorner",
  "armchair",
  "beanbag",
]);

/**
 * The tiles a furniture sprite actually blocks: those it substantially covers
 * (≥ 50%). Decoration and sittable furniture block nothing (the latter so you
 * can walk onto a seat to sit); other tiles it only clips stay walkable and are
 * handled by the player's corner-nudge.
 */
export function propBlockedTiles(prop: PropType, tx: number, ty: number): Array<[number, number]> {
  if (DECORATION_PROPS.includes(prop) || WALKABLE_FURNITURE.has(prop)) return [];
  return propCoverageTiles(prop, tx, ty, COLLISION_COVERAGE);
}

/**
 * Dumps the compiled collision grid for a tile region to a string ('#' blocked,
 * '.' walkable, ' ' out of bounds) so phantom collision on walkable floor is
 * visible. Purely diagnostic.
 */
export function dumpCollisionRegion(
  map: OfficeMapData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): string {
  let out = `collision [${x0},${y0}]–[${x1},${y1}] ( # = blocked, . = walkable ):\n`;
  for (let y = y0; y <= y1; y++) {
    let row = "";
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) row += " ";
      else row += map.collision[y][x] ? "#" : ".";
    }
    out += row + "\n";
  }
  return out;
}

export function createCollisionMap(map: OfficeMapData): CollisionMap {
  return {
    width: map.width,
    height: map.height,
    isWalkable(tileX, tileY) {
      if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return false;
      return !map.collision[tileY][tileX];
    },
  };
}

/**
 * A spawn tile near the map center. Searches outward in rings and prefers a
 * tile with all four orthogonal neighbors also walkable, so the avatar starts
 * in open space rather than wedged against furniture; falls back to any
 * walkable tile, then the center.
 */
export function getSpawnTile(map: OfficeMapData): { tx: number; ty: number } {
  const cx = Math.floor(map.width / 2);
  const cy = Math.floor(map.height / 2);
  const walkable = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < map.width && y < map.height && !map.collision[y][x];
  const clear = (x: number, y: number) =>
    walkable(x, y) &&
    walkable(x - 1, y) &&
    walkable(x + 1, y) &&
    walkable(x, y - 1) &&
    walkable(x, y + 1);

  let fallback: { tx: number; ty: number } | null = null;
  const maxR = Math.max(map.width, map.height);
  for (let r = 0; r < maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring perimeter only
        const x = cx + dx;
        const y = cy + dy;
        if (clear(x, y)) return { tx: x, ty: y };
        if (!fallback && walkable(x, y)) fallback = { tx: x, ty: y };
      }
    }
  }
  return fallback ?? { tx: cx, ty: cy };
}
