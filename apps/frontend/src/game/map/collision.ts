import type { OfficeMapData } from "./schema";

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
