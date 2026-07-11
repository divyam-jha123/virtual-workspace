import { AnimatedSprite, type Spritesheet } from "pixi.js";
import type { Facing } from "shared-types";
import type { Direction } from "./characters";

/** Fraction of the remaining gap closed per 60fps-frame — smooths the ~10 Hz
 *  lossy updates into continuous motion without lagging far behind. */
const LERP = 0.25;
/** Below this per-frame move (px) the avatar is treated as standing (idle pose). */
const MOVING_EPS = 0.15;
const ANIM_SPEED = 0.18;

/**
 * Another participant's avatar. PixiWorld feeds it target positions decoded from
 * LiveKit (`setTarget`) and advances it each frame (`update`); it eases toward
 * the latest target and plays walk/idle for the reported facing. It reuses the
 * same character spritesheet format as the local Player, so it depth-sorts in
 * the furniture layer identically.
 */
export class RemotePlayer {
  readonly sprite: AnimatedSprite;
  private x: number;
  private y: number;
  private targetX: number;
  private targetY: number;
  private facing: Direction = "down";
  private animKey = "";

  constructor(
    private sheet: Spritesheet,
    /** Which character this peer is currently rendered as (can be corrected
     *  later via setCharacter once their name propagates). */
    public characterId: string,
    x: number,
    y: number,
  ) {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.sprite = new AnimatedSprite(sheet.animations.walk_down);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.animationSpeed = ANIM_SPEED;
    this.sprite.gotoAndStop(0);
    this.render();
  }

  /** Swap to the peer's real character once we learn it (fixes the brief
   *  default-sprite fallback when their name hadn't propagated yet). */
  setCharacter(sheet: Spritesheet, characterId: string): void {
    this.sheet = sheet;
    this.characterId = characterId;
    this.animKey = ""; // force update() to re-bind textures from the new sheet
  }

  /** Newest known position/facing from the network (target to ease toward). */
  setTarget(x: number, y: number, facing?: Facing): void {
    this.targetX = x;
    this.targetY = y;
    if (facing) this.facing = facing;
  }

  /** Ease toward the target and pick walk/idle. `deltaTime` is ticker frames. */
  update(deltaTime: number): void {
    const k = 1 - Math.pow(1 - LERP, deltaTime); // frame-rate independent easing
    const nx = this.x + (this.targetX - this.x) * k;
    const ny = this.y + (this.targetY - this.y) * k;
    const moving = Math.hypot(nx - this.x, ny - this.y) > MOVING_EPS;
    this.x = nx;
    this.y = ny;
    this.animate(moving);
    this.render();
  }

  private animate(moving: boolean): void {
    const key = `${moving ? "walk" : "idle"}_${this.facing}`;
    if (key === this.animKey) return;
    this.animKey = key;
    if (moving) {
      this.sprite.textures = this.sheet.animations[`walk_${this.facing}`];
      this.sprite.play();
    } else {
      this.sprite.textures = [this.sheet.textures[`${this.facing}0`]];
      this.sprite.gotoAndStop(0);
    }
  }

  private render(): void {
    this.sprite.x = Math.round(this.x);
    this.sprite.y = Math.round(this.y);
    this.sprite.zIndex = this.y; // depth-sort against furniture + the local player
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
