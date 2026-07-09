import type { Container } from "pixi.js";

/**
 * A 2D camera over a world container. Owns zoom + scroll (the world-space
 * top-left of the viewport) and knows the world/screen sizes so it can clamp
 * itself to bounds. Supports two use styles:
 *
 *  - spectate: free `moveScroll` panning + pointer-anchored `zoomAt` (the
 *    world point under the cursor stays put while the zoom eases in/out).
 *  - follow: `centerOn(target)` each frame + `nudgeZoom` (zoom toward the
 *    current center, i.e. the followed avatar).
 *
 * `update(dtMS)` eases the current zoom toward its target; `apply(container)`
 * writes the transform. Callers drive state, then call update + apply per tick.
 */
const ZOOM_LERP_SPEED = 12;
/** Per-60fps-frame fraction the camera focus moves toward the target (deltaTime-scaled). */
const FOLLOW_LERP = 0.1;
/** Don't chase movement smaller than this (world px) — kills idle micro-jitter. */
const FOLLOW_DEADZONE = 4;

export class Camera {
  private zoomValue: number;
  private targetZoom: number;
  private scrollX = 0;
  private scrollY = 0;
  private minZoom = 0.1;

  private anchored = false;
  private anchorScreen = { x: 0, y: 0 };
  private anchorWorld = { x: 0, y: 0 };

  /** Smoothed focus point (world px) used by follow(); undefined until first snap. */
  private focusX?: number;
  private focusY?: number;

  constructor(
    private worldW: number,
    private worldH: number,
    private screenW: number,
    private screenH: number,
    private maxZoom: number,
    initialZoom: number,
  ) {
    this.recomputeMinZoom();
    this.zoomValue = Math.min(this.maxZoom, Math.max(this.minZoom, initialZoom));
    this.targetZoom = this.zoomValue;
  }

  get zoom(): number {
    return this.zoomValue;
  }

  resize(screenW: number, screenH: number): void {
    this.screenW = screenW;
    this.screenH = screenH;
    this.recomputeMinZoom();
  }

  private recomputeMinZoom(): void {
    this.minZoom = Math.max(this.screenW / this.worldW, this.screenH / this.worldH);
    if (this.targetZoom < this.minZoom) this.targetZoom = this.minZoom;
    if (this.zoomValue < this.minZoom) this.zoomValue = this.minZoom;
  }

  private clampZoom(z: number): number {
    return Math.max(this.minZoom, Math.min(this.maxZoom, z));
  }

  /** Set current+target zoom to a multiple of the fit-to-screen minimum. */
  setZoomFromFit(multiplier: number): void {
    this.zoomValue = this.clampZoom(this.minZoom * multiplier);
    this.targetZoom = this.zoomValue;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx / this.zoomValue + this.scrollX, y: sy / this.zoomValue + this.scrollY };
  }

  /** Pointer-anchored zoom (spectate): keep the world point under (sx,sy) fixed. */
  zoomAt(deltaY: number, sx: number, sy: number): void {
    const world = this.screenToWorld(sx, sy);
    this.targetZoom = this.clampZoom(this.targetZoom * Math.pow(1.1, -deltaY / 100));
    this.anchored = true;
    this.anchorScreen = { x: sx, y: sy };
    this.anchorWorld = world;
  }

  /** Zoom toward the current center (follow mode); centerOn re-fixes the target after. */
  nudgeZoom(deltaY: number): void {
    this.targetZoom = this.clampZoom(this.targetZoom * Math.pow(1.1, -deltaY / 100));
    this.anchored = false;
  }

  /** Pan by a world-space delta (spectate free pan / drag). */
  moveScroll(dxWorld: number, dyWorld: number): void {
    this.scrollX += dxWorld;
    this.scrollY += dyWorld;
    this.anchored = false;
    this.clampScroll();
  }

  /** Center the viewport on a world point instantly (spectate / initial framing). */
  centerOn(worldX: number, worldY: number): void {
    this.scrollX = worldX - this.screenW / this.zoomValue / 2;
    this.scrollY = worldY - this.screenH / this.zoomValue / 2;
    this.clampScroll();
  }

  /** Snap the smoothed follow focus to a point (no easing) — use on spawn. */
  snapFocus(worldX: number, worldY: number): void {
    this.focusX = worldX;
    this.focusY = worldY;
    this.centerOn(worldX, worldY);
  }

  /**
   * Ease the camera toward a target world point (play mode). Lerp is
   * deltaTime-scaled so it's frame-rate independent, with a small deadzone so
   * the camera doesn't micro-jitter while the avatar is idle. Bounds are
   * clamped after the lerp.
   */
  follow(targetX: number, targetY: number, deltaTime: number): void {
    if (this.focusX === undefined || this.focusY === undefined) {
      this.snapFocus(targetX, targetY);
      return;
    }
    const dist = Math.hypot(targetX - this.focusX, targetY - this.focusY);
    if (dist > FOLLOW_DEADZONE) {
      const k = 1 - Math.pow(1 - FOLLOW_LERP, deltaTime);
      this.focusX += (targetX - this.focusX) * k;
      this.focusY += (targetY - this.focusY) * k;
    }
    this.scrollX = this.focusX - this.screenW / this.zoomValue / 2;
    this.scrollY = this.focusY - this.screenH / this.zoomValue / 2;
    this.clampScroll();
  }

  private clampScroll(): void {
    const viewW = this.screenW / this.zoomValue;
    const viewH = this.screenH / this.zoomValue;
    const maxX = Math.max(0, this.worldW - viewW);
    const maxY = Math.max(0, this.worldH - viewH);
    this.scrollX = maxX > 0 ? Math.max(0, Math.min(maxX, this.scrollX)) : maxX / 2;
    this.scrollY = maxY > 0 ? Math.max(0, Math.min(maxY, this.scrollY)) : maxY / 2;
  }

  update(dtMS: number): void {
    if (Math.abs(this.targetZoom - this.zoomValue) > 0.0005) {
      const t = Math.min(1, (dtMS / 1000) * ZOOM_LERP_SPEED);
      this.zoomValue += (this.targetZoom - this.zoomValue) * t;
      if (Math.abs(this.targetZoom - this.zoomValue) < 0.0005) this.zoomValue = this.targetZoom;

      if (this.anchored) {
        this.scrollX = this.anchorWorld.x - this.anchorScreen.x / this.zoomValue;
        this.scrollY = this.anchorWorld.y - this.anchorScreen.y / this.zoomValue;
      }
      this.clampScroll();
    }
  }

  apply(container: Container): void {
    container.scale.set(this.zoomValue);
    // Round the final on-screen position so tiles/sprites don't shimmer.
    container.position.set(
      Math.round(-this.scrollX * this.zoomValue),
      Math.round(-this.scrollY * this.zoomValue),
    );
  }
}
