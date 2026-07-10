import type { Direction } from "./characters";
import type { OfficeMapData } from "../map/schema";
import type { PropType } from "../map/props";
import { propCoverageTiles } from "../map/collision";
import { TILE_SIZE } from "../map/tileset";

/**
 * A seat the avatar can auto-sit on. `x,y` is the seat tile (a furniture tile),
 * `facing` is the look direction while seated, `type` selects the visual sit
 * offset (see SEAT_TYPE_OFFSETS). Seats are AUTO-GENERATED from the map's
 * furniture (see generateSeats) so every sittable tile gets one; add special
 * cases to SEAT_OVERRIDES.
 */
export interface SeatDef {
  x: number;
  y: number;
  facing: Direction;
  type: SeatType;
  /** Optional world-y to base the seated depth on. Desk-pod chairs use the
   *  pod's y so the avatar sorts in front of the (single, large) pod sprite
   *  instead of being hidden behind it. Omitted → the seat's own feet y. */
  sitZ?: number;
}

export type SeatType = "chair" | "sofa" | "stool" | "deskchair";

/**
 * Per-type pixel offset applied to the seated sprite so the avatar sits ON the
 * furniture rather than beside/above it. +y sinks it into the cushion. Tune
 * these freely — pure data, no logic depends on the exact values.
 */
export const SEAT_TYPE_OFFSETS: Record<SeatType, { x: number; y: number }> = {
  chair: { x: 0, y: 8 },
  sofa: { x: 0, y: 6 },
  stool: { x: 0, y: 4 },
  deskchair: { x: 0, y: 6 }, // meeting-table chairs (top/bottom rows)
};

/** Manual seat additions per map, merged after the auto-generated ones. */
export const SEAT_OVERRIDES: Record<string, SeatDef[]> = {
  // e.g. slate: [{ x: 12, y: 34, facing: "up", type: "chair" }],
};

/** Which furniture props are sittable, and the seat type each maps to. */
const SITTABLE: Partial<Record<PropType, SeatType>> = {
  chair: "chair",
  stool: "stool",
  sofa: "sofa",
  sofaV: "sofa",
  sofaCorner: "sofa",
  armchair: "sofa",
  beanbag: "sofa",
};

/** Desk pods bake their chairs into one sprite → row count per pod so we can
 *  place a seat at each left/right chair (facing the desk in the middle). */
const POD_ROWS: Partial<Record<PropType, number>> = { pod2: 1, pod4: 2, pod6: 3 };

/** Meeting tables bake a chair row above and below the tabletop → chairs per
 *  side (the sprite is 3 tile-rows tall: chairs at ty-2 face down, table at
 *  ty-1, chairs at ty face up). Must match drawMeetingTable's `cols`. */
const MEETING_COLS: Partial<Record<PropType, number>> = { meetsmall: 3, boardtable: 5 };

/** Props a seat would face toward (you sit looking at a desk/table/screen). */
const FACE_TARGETS = new Set<PropType>([
  "deskSolo",
  "pod2",
  "pod4",
  "pod6",
  "boardtable",
  "meetsmall",
  "trainpair",
  "coffeetable",
  "counter",
  "tv",
  "boardgame",
]);

const DIRS: Array<[Direction, number, number]> = [
  ["up", 0, -1],
  ["down", 0, 1],
  ["left", -1, 0],
  ["right", 1, 0],
];

/**
 * Builds a seat for every sittable furniture tile on the map. Multi-tile sofas
 * (built from sofa/sofaV/sofaCorner sections) yield one seat per section tile.
 * Facing is inferred from the nearest desk/table/screen, else away from an
 * adjacent wall.
 */
export function generateSeats(map: OfficeMapData): SeatDef[] {
  // tile → prop, covering each furniture's tiles, for facing inference.
  const propAt = new Map<string, PropType>();
  for (const f of map.furniture) {
    for (const [x, y] of propCoverageTiles(f.prop, f.tx, f.ty, 0.3)) propAt.set(`${x},${y}`, f.prop);
  }

  const seats: SeatDef[] = [];
  const seen = new Set<string>();
  const add = (s: SeatDef) => {
    const key = `${s.x},${s.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    seats.push(s);
  };

  for (const f of map.furniture) {
    // Desk pods: a chair each side of every desk row, facing the desk. The
    // avatar sorts in front of the pod sprite via sitZ.
    const rows = POD_ROWS[f.prop];
    if (rows) {
      const sitZ = (f.ty + 1) * TILE_SIZE;
      for (let r = 0; r < rows; r++) {
        const y = f.ty - (rows - 1) + r;
        add({ x: f.tx - 1, y, facing: "right", type: "chair", sitZ });
        add({ x: f.tx + 1, y, facing: "left", type: "chair", sitZ });
      }
      continue;
    }

    // Meeting tables: a chair per column on the top row (ty-2, facing down,
    // sorts BEHIND the tabletop) and the bottom row (ty, facing up, sorts in
    // FRONT of it). See MEETING_COLS / drawMeetingTable for the geometry.
    const cols = MEETING_COLS[f.prop];
    if (cols) {
      const half = (cols - 1) / 2;
      for (let c = -half; c <= half; c++) {
        add({ x: f.tx + c, y: f.ty - 2, facing: "down", type: "deskchair", sitZ: (f.ty - 1) * TILE_SIZE });
        add({ x: f.tx + c, y: f.ty, facing: "up", type: "deskchair", sitZ: (f.ty + 1) * TILE_SIZE + 24 });
      }
      continue;
    }

    const type = SITTABLE[f.prop];
    if (!type) continue;
    for (const [x, y] of seatTiles(f.prop, f.tx, f.ty)) {
      add({ x, y, facing: inferFacing(map, propAt, x, y), type });
    }
  }

  const merged = [...seats, ...(SEAT_OVERRIDES[map.key] ?? [])];
  // eslint-disable-next-line no-console
  console.log(`[seats] ${merged.length} seats detected on "${map.key}" (${seats.length} auto + ${SEAT_OVERRIDES[map.key]?.length ?? 0} manual)`);
  return merged;
}

/** Tiles a sittable piece offers a seat on: the anchor tile always, plus any
 *  extra tile it substantially covers (so a tall sofaV yields one seat per
 *  section) — independent of whether the tile blocks movement. */
function seatTiles(prop: PropType, tx: number, ty: number): Array<[number, number]> {
  const tiles = propCoverageTiles(prop, tx, ty, 0.5);
  if (!tiles.some(([x, y]) => x === tx && y === ty)) tiles.push([tx, ty]);
  return tiles;
}

function inferFacing(map: OfficeMapData, propAt: Map<string, PropType>, x: number, y: number): Direction {
  // Face the nearest desk/table/screen within 2 tiles.
  let best: Direction | null = null;
  let bestDist = 99;
  for (const [dir, dx, dy] of DIRS) {
    for (let d = 1; d <= 2; d++) {
      const p = propAt.get(`${x + dx * d},${y + dy * d}`);
      if (p && FACE_TARGETS.has(p)) {
        if (d < bestDist) {
          bestDist = d;
          best = dir;
        }
        break;
      }
    }
  }
  if (best) return best;

  // Otherwise face away from an adjacent wall / edge (sit with back to the wall).
  for (const [dir, dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    const wall = ny < 0 || nx < 0 || ny >= map.height || nx >= map.width || map.walls[ny][nx] >= 0;
    if (wall) return opposite(dir);
  }
  return "down";
}

function opposite(d: Direction): Direction {
  return d === "up" ? "down" : d === "down" ? "up" : d === "left" ? "right" : "left";
}

// ---------------------------------------------------------------------------

type SitPhase = "walking" | "sitting" | "seated" | "standing";

const SIT_DURATION = 250; // ms — ease into the seat (tune here)
const STAND_DURATION = 180; // ms — ease out of the seat (tune here)
const STAND_COOLDOWN_MS = 600; // ignore the seat we just left this long

/**
 * Owns the auto-sit state machine: trigger detection, the timed ease into/out
 * of a seat, and the cooldown. Position easing is exposed via advance() —
 * PixiWorld drives the avatar's position from it, so the movement/physics code
 * is never touched.
 */
export class SeatManager {
  private seats: SeatDef[];
  private phase: SitPhase = "walking";
  private seat: SeatDef | null = null;
  private from = { x: 0, y: 0 };
  private to = { x: 0, y: 0 };
  private startMs = 0;
  private durMs = 0;
  private cooldownSeat: SeatDef | null = null;
  private cooldownUntil = 0;

  constructor(map: OfficeMapData) {
    this.seats = generateSeats(map);
  }

  get isWalking(): boolean {
    return this.phase === "walking";
  }
  get isSeated(): boolean {
    return this.phase === "seated";
  }
  /** Input is locked in every phase except free walking. */
  get isLocked(): boolean {
    return this.phase !== "walking";
  }
  get transitioning(): boolean {
    return this.phase === "sitting" || this.phase === "standing";
  }
  get isSitting(): boolean {
    return this.phase === "sitting";
  }
  get isStanding(): boolean {
    return this.phase === "standing";
  }
  get currentSeat(): SeatDef | null {
    return this.seat;
  }

  offset(type: SeatType): { x: number; y: number } {
    return SEAT_TYPE_OFFSETS[type];
  }

  /**
   * The seat to sit on — only when the feet tile IS a seat tile (not adjacent),
   * so it never acts as a collider: walking past a chair never grabs the
   * player; you sit only by stepping onto the seat tile itself. (Seat tiles are
   * walkable — see collision — so this is reachable.)
   */
  trigger(tileX: number, tileY: number, nowMs: number): SeatDef | null {
    if (this.phase !== "walking") return null;
    for (const s of this.seats) {
      if (s === this.cooldownSeat && nowMs < this.cooldownUntil) continue;
      if (s.x === tileX && s.y === tileY) return s;
    }
    return null;
  }

  beginSit(seat: SeatDef, fromX: number, fromY: number, nowMs: number): void {
    this.phase = "sitting";
    this.seat = seat;
    this.from = { x: fromX, y: fromY };
    this.to = { x: (seat.x + 0.5) * TILE_SIZE, y: (seat.y + 1) * TILE_SIZE };
    this.startMs = nowMs;
    this.durMs = SIT_DURATION;
  }

  beginStand(fromX: number, fromY: number, toX: number, toY: number, nowMs: number): void {
    this.phase = "standing";
    this.from = { x: fromX, y: fromY };
    this.to = { x: toX, y: toY };
    this.startMs = nowMs;
    this.durMs = STAND_DURATION;
  }

  /** Eased position along the current transition (ease-out quad). */
  advance(nowMs: number): { x: number; y: number; done: boolean } {
    const p = this.durMs > 0 ? Math.min(1, (nowMs - this.startMs) / this.durMs) : 1;
    const e = 1 - (1 - p) * (1 - p);
    return {
      x: this.from.x + (this.to.x - this.from.x) * e,
      y: this.from.y + (this.to.y - this.from.y) * e,
      done: p >= 1,
    };
  }

  finishSit(): void {
    this.phase = "seated";
  }

  finishStand(nowMs: number): void {
    this.cooldownSeat = this.seat;
    this.cooldownUntil = nowMs + STAND_COOLDOWN_MS;
    this.seat = null;
    this.phase = "walking";
  }
}
