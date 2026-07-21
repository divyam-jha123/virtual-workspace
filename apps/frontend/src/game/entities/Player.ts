import { AnimatedSprite, type Spritesheet } from "pixi.js";
import { TILE_SIZE } from "../map/tileset";
import { NameTag } from "./NameTag";
import type { CollisionMap } from "../map/collision";
import type { InputVector } from "./Input";
import type { Direction } from "./characters";

/** Green dot on the local player's name pill — marks "you". */
const YOU_DOT = 0x3fae4c;

/** Top speed in world px per 60fps-frame; actual step scales by ticker deltaTime. */
const MAX_SPEED = 2.6;
/** Velocity easing time constants (ms): short so movement feels snappy, not floaty. */
const ACCEL_TAU = 50;
const DECEL_TAU = 40;
/** Feet hitbox: ~60% tile wide, short — anchored at the sprite's feet, not full bounds. */
const FEET_W = 19;
const FEET_H = 10;
/** Corner nudging: slip up to this many px toward an opening to round a corner,
 *  at a GENTLE speed — too strong shoves the avatar sideways and feels drunk. */
const CORNER_MAX = 12;
const CORNER_SPEED = 1.5; // px/frame the nudge eases at (max)
/** Release below this speed → hard-zero the velocity so there's never residual drift. */
const IDLE_EPS = 0.05;
const BASE_ANIM = 0.22;
const EPS = 1e-4;
/** Clamp a lag-spike frame so the avatar can't teleport/overshoot on a stutter. */
const MAX_DELTA = 2.0;
const MAX_DELTA_MS = (MAX_DELTA * 1000) / 60;

/**
 * The player avatar. Physics is delta-time based with eased accel/decel;
 * collision is resolved on X and Y independently (so the avatar slides along
 * walls instead of stopping dead) using a small feet hitbox, with corner
 * nudging to slip through 1-tile doorways. Position is kept as floats and
 * only rounded at render time to avoid texture shimmer.
 */
export class Player {
  readonly sprite: AnimatedSprite;
  private readonly nameTag: NameTag;
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
    displayName = "",
  ) {
    this.x = (spawnTileX + 0.5) * TILE_SIZE;
    this.y = (spawnTileY + 1) * TILE_SIZE;

    this.sprite = new AnimatedSprite(sheet.animations.walk_down);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.animationSpeed = BASE_ANIM;
    this.sprite.gotoAndStop(0);
    this.animKey = "idle_down";
    // Child of the sprite → the tag follows the avatar and depth-sorts with it.
    this.nameTag = new NameTag(displayName, { dotColor: YOU_DOT });
    this.sprite.addChild(this.nameTag.view);
    this.render();
  }

  /** Update the label above the head (e.g. once a real login name arrives). */
  setDisplayName(name: string): void {
    this.nameTag.setText(name);
  }

  get tileX(): number {
    return Math.floor(this.x / TILE_SIZE);
  }
  get tileY(): number {
    return Math.floor((this.y - 1) / TILE_SIZE);
  }
  /** Current look direction — published to peers over LiveKit. */
  get facingDir(): Direction {
    return this.facing;
  }

  /** Step 1+2 of the loop: integrate eased velocity and resolve collision. */
  updatePhysics(deltaTime: number, dtMS: number, input: InputVector, col: CollisionMap): void {
    // Clamp lag spikes so a stutter frame can't fling the avatar.
    deltaTime = Math.min(deltaTime, MAX_DELTA);
    dtMS = Math.min(dtMS, MAX_DELTA_MS);

    const targetVx = input.x * MAX_SPEED;
    const targetVy = input.y * MAX_SPEED;
    // On a direction reversal, drop the old-direction momentum immediately so
    // switching direction mid-walk redirects at full control (no drift).
    if (targetVx !== 0 && Math.sign(targetVx) !== Math.sign(this.vx)) this.vx = 0;
    if (targetVy !== 0 && Math.sign(targetVy) !== Math.sign(this.vy)) this.vy = 0;

    const pushing = input.x !== 0 || input.y !== 0;
    const s = 1 - Math.exp(-dtMS / (pushing ? ACCEL_TAU : DECEL_TAU));
    this.vx += (targetVx - this.vx) * s;
    this.vy += (targetVy - this.vy) * s;
    // Hard-zero once below threshold → no residual sub-pixel drift, ever.
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

  /**
   * Pose helpers for auto-sit. These don't touch the movement/collision logic —
   * PixiWorld eases the avatar toward the seat, stops calling updatePhysics/
   * updateAnimation while seated/transitioning, and drives these poses.
   */

  /** Set the logical feet position and re-render (used to ease into/out of a seat). */
  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.render();
  }

  /** Show the walk cycle facing a direction (during the sit/stand glide). */
  poseWalk(facing: Direction): void {
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.facing = facing;
    this.animKey = `walk_${facing}`;
    this.sprite.textures = this.sheet.animations[`walk_${facing}`];
    this.sprite.animationSpeed = BASE_ANIM;
    this.sprite.play();
  }

  /**
   * Final seated pose: idle frame of `facing`, nudged by the per-type sprite
   * offset so it sits on the cushion, at an explicit depth (`zIndex`) so it
   * sorts correctly against the seat.
   */
  sit(facing: Direction, offsetX: number, offsetY: number, zIndex: number): void {
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.facing = facing;
    this.animKey = `sit_${facing}`;
    this.sprite.textures = [this.sheet.textures[`${facing}0`]];
    this.sprite.gotoAndStop(0);
    this.sprite.x = Math.round(this.x + offsetX);
    this.sprite.y = Math.round(this.y + offsetY);
    this.sprite.zIndex = zIndex;
  }

  stand(): void {
    this.animKey = ""; // force updateAnimation to re-evaluate next frame
    this.render(); // clears the sit offset + depth bias
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
