import { AnimatedSprite, type Spritesheet } from "pixi.js";
import { TILE_SIZE } from "../map/tileset";
import type { CollisionMap } from "../map/collision";
import type { InputVector } from "./Input";
import type { Direction } from "./characters";

/** Top speed in world px per 60fps-frame; actual step scales by ticker deltaTime. */
const MAX_SPEED = 2.6;
/** Velocity easing time constants (ms): quick ramp up, quicker settle to stop. */
const ACCEL_TAU = 80;
const DECEL_TAU = 60;
/** Feet hitbox: ~60% tile wide, short — anchored at the sprite's feet, not full bounds. */
const FEET_W = 19;
const FEET_H = 10;
/** Corner nudging: slip up to this many px (< 40% tile) toward an opening to round a corner. */
const CORNER_MAX = 12;
const CORNER_SPEED = 3; // px/frame the nudge eases at
/** Below this speed the avatar is considered idle (so anim doesn't flicker mid-turn). */
const IDLE_EPS = 0.05;
const BASE_ANIM = 0.22;
const EPS = 1e-4;

/**
 * The player avatar. Physics is delta-time based with eased accel/decel;
 * collision is resolved on X and Y independently (so the avatar slides along
 * walls instead of stopping dead) using a small feet hitbox, with corner
 * nudging to slip through 1-tile doorways. Position is kept as floats and
 * only rounded at render time to avoid texture shimmer.
 */
export class Player {
  readonly sprite: AnimatedSprite;
  x: number;
  y: number;
  private vx = 0;
  private vy = 0;
  private speed = 0;
  private facing: Direction = "down";
  private animKey = "";
  private static loggedRows = new Set<Direction>();

  constructor(
    private sheet: Spritesheet,
    spawnTileX: number,
    spawnTileY: number,
  ) {
    this.x = (spawnTileX + 0.5) * TILE_SIZE;
    this.y = (spawnTileY + 1) * TILE_SIZE;

    this.sprite = new AnimatedSprite(sheet.animations.walk_down);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.animationSpeed = BASE_ANIM;
    this.sprite.gotoAndStop(0);
    this.animKey = "idle_down";
    this.render();
  }

  get tileX(): number {
    return Math.floor(this.x / TILE_SIZE);
  }
  get tileY(): number {
    return Math.floor((this.y - 1) / TILE_SIZE);
  }

  /** Step 1+2 of the loop: integrate eased velocity and resolve collision. */
  updatePhysics(deltaTime: number, dtMS: number, input: InputVector, col: CollisionMap): void {
    const targetVx = input.x * MAX_SPEED;
    const targetVy = input.y * MAX_SPEED;
    const pushing = input.x !== 0 || input.y !== 0;
    const s = 1 - Math.exp(-dtMS / (pushing ? ACCEL_TAU : DECEL_TAU));
    this.vx += (targetVx - this.vx) * s;
    this.vy += (targetVy - this.vy) * s;
    // Cut the imperceptible sub-pixel decel tail so releasing a key stops the
    // avatar cleanly (no lingering creep / drift) while keeping the ease.
    if (Math.abs(this.vx) < IDLE_EPS) this.vx = 0;
    if (Math.abs(this.vy) < IDLE_EPS) this.vy = 0;

    const dx = this.vx * deltaTime;
    const dy = this.vy * deltaTime;

    // X axis — independent resolution + corner nudge on pure-horizontal moves.
    if (dx !== 0) {
      if (this.canStand(this.x + dx, this.y, col)) {
        this.x += dx;
      } else if (Math.abs(dy) < EPS) {
        if (!this.cornerNudgeVertical(dx, deltaTime, col)) this.vx = 0;
      } else {
        this.vx = 0; // diagonal into wall → cancel only this axis, keep sliding on Y
      }
    }

    // Y axis — same, independent of X so diagonal input slides.
    if (dy !== 0) {
      if (this.canStand(this.x, this.y + dy, col)) {
        this.y += dy;
      } else if (Math.abs(dx) < EPS) {
        if (!this.cornerNudgeHorizontal(dy, deltaTime, col)) this.vy = 0;
      } else {
        this.vy = 0;
      }
    }

    // Facing follows the velocity vector every frame: dominant axis wins, so
    // moving down faces down, up faces up, etc. Ties / pure-horizontal fall to
    // left/right. When stopped we keep the last facing (don't reset to down).
    this.speed = Math.hypot(this.vx, this.vy);
    if (this.speed > IDLE_EPS) {
      if (Math.abs(this.vy) > Math.abs(this.vx)) {
        this.facing = this.vy > 0 ? "down" : "up";
      } else if (this.vx !== 0) {
        this.facing = this.vx > 0 ? "right" : "left";
      }
    }

    this.render();
  }

  /** Step 4: pick walk/idle clip + scale leg speed to actual velocity. */
  updateAnimation(): void {
    const moving = this.speed > IDLE_EPS;
    const key = moving ? `walk_${this.facing}` : `idle_${this.facing}`;
    if (key !== this.animKey) {
      this.animKey = key;
      if (moving) {
        this.sprite.textures = this.sheet.animations[`walk_${this.facing}`];
        this.sprite.play();
        this.logRowOnce();
      } else {
        this.sprite.textures = [this.sheet.textures[`${this.facing}0`]];
        this.sprite.gotoAndStop(0);
      }
    }
    if (moving) this.sprite.animationSpeed = BASE_ANIM * Math.min(1, this.speed / MAX_SPEED);
  }

  /** Dev-only: log the sheet row backing each facing the first time it's used,
   *  so we can confirm down/up/left/right rows aren't swapped. */
  private logRowOnce(): void {
    if (!import.meta.env.DEV || Player.loggedRows.has(this.facing)) return;
    Player.loggedRows.add(this.facing);
    const frame = this.sprite.textures[0] as { frame?: { y: number } };
    const y = frame.frame?.y ?? -1;
    // eslint-disable-next-line no-console
    console.log(`[facing] "${this.facing}" → sheet row ${y / 48} (y=${y})`);
  }

  /** Moving horizontally but blocked: nudge Y toward a nearby opening to round the corner. */
  private cornerNudgeVertical(dx: number, dt: number, col: CollisionMap): boolean {
    for (let n = 1; n <= CORNER_MAX; n++) {
      if (this.canStand(this.x + dx, this.y - n, col)) {
        this.y -= Math.min(n, CORNER_SPEED * dt);
        return true;
      }
      if (this.canStand(this.x + dx, this.y + n, col)) {
        this.y += Math.min(n, CORNER_SPEED * dt);
        return true;
      }
    }
    return false;
  }

  /** Moving vertically but blocked: nudge X toward a nearby opening (doorway alignment). */
  private cornerNudgeHorizontal(dy: number, dt: number, col: CollisionMap): boolean {
    for (let n = 1; n <= CORNER_MAX; n++) {
      if (this.canStand(this.x - n, this.y + dy, col)) {
        this.x -= Math.min(n, CORNER_SPEED * dt);
        return true;
      }
      if (this.canStand(this.x + n, this.y + dy, col)) {
        this.x += Math.min(n, CORNER_SPEED * dt);
        return true;
      }
    }
    return false;
  }

  /** True if the feet hitbox at (px,py) covers only walkable tiles. */
  private canStand(px: number, py: number, col: CollisionMap): boolean {
    const hw = FEET_W / 2;
    const tx0 = Math.floor((px - hw) / TILE_SIZE);
    const tx1 = Math.floor((px + hw - EPS) / TILE_SIZE);
    const ty0 = Math.floor((py - FEET_H) / TILE_SIZE);
    const ty1 = Math.floor((py - EPS) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!col.isWalkable(tx, ty)) return false;
      }
    }
    return true;
  }

  /** Floats internally; round only here so the sprite never shimmers. */
  private render(): void {
    this.sprite.x = Math.round(this.x);
    this.sprite.y = Math.round(this.y);
    this.sprite.zIndex = this.y; // depth-sort against furniture
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
