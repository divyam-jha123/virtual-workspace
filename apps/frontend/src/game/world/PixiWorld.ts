import { Application, Container, Sprite } from "pixi.js";
import type { OfficeMapData } from "../map/schema";
import type { OfficeTheme } from "../map/themes";
import { TILE_SIZE, getTileTexture, Tile } from "../map/tileset";
import { getPropTexture } from "../map/props";

const PAN_SPEED = 420;
const MAX_ZOOM = 4;
/**
 * Zoom to open a map at: 1x, the native/unscaled resolution the pixel art
 * was drawn at (one 32px tile = 32 screen px). `minZoom` (fit the whole map
 * on screen) shrinks an ~80-tile-wide office down to a few pixels per desk —
 * far too small — but opening pre-zoomed-in past 1x reads as artificially
 * zoomed rather than "normal". Players scroll/pan to see the rest.
 */
const DEFAULT_ZOOM = 1;
/** How fast the current zoom chases the target zoom each second (1 = instant-ish). */
const ZOOM_LERP_SPEED = 12;
const PAN_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
]);

export interface PixiWorldOptions {
  container: HTMLElement;
  map: OfficeMapData;
  theme: OfficeTheme;
  onExit: () => void;
}

/**
 * Renders one OfficeMapData as a layered PixiJS scene (floor → walls →
 * decoration → depth-sorted furniture) and drives camera pan/zoom from
 * keyboard, drag and wheel input. Purely data-driven: it has no idea what a
 * "boardroom" is, it just draws tiles and props from the map.
 *
 * Zoom is pointer-anchored (Figma/Google Maps style): the world point under
 * the cursor at the moment of the wheel event stays under the cursor as the
 * zoom eases toward its new target. Trackpad pinch-zoom reaches this same
 * code path since browsers dispatch it as a `wheel` event (with `ctrlKey`),
 * so no separate handling is needed.
 */
export class PixiWorld {
  private app: Application;
  private world: Container;
  private opts: PixiWorldOptions;
  private worldW: number;
  private worldH: number;
  private minZoom = 1;
  private zoom = 1;
  private targetZoom = 1;
  private scrollX = 0;
  private scrollY = 0;
  /** World point that must stay under `anchorScreen` while zoom eases toward its target. */
  private anchorWorld = { x: 0, y: 0 };
  private anchorScreen = { x: 0, y: 0 };
  private hasAnchor = false;
  private heldKeys = new Set<string>();
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      this.opts.onExit();
      return;
    }
    if (PAN_KEYS.has(e.code)) this.heldKeys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { x: sx, y: sy } = this.toCanvasPoint(e.clientX, e.clientY);
    const worldX = sx / this.zoom + this.scrollX;
    const worldY = sy / this.zoom + this.scrollY;
    const factor = Math.pow(1.1, -e.deltaY / 100);
    this.targetZoom = Math.max(this.minZoom, Math.min(MAX_ZOOM, this.targetZoom * factor));
    this.anchorScreen = { x: sx, y: sy };
    this.anchorWorld = { x: worldX, y: worldY };
    this.hasAnchor = true;
  };
  private onPointerDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.scrollX -= (e.clientX - this.lastPointer.x) / this.zoom;
    this.scrollY -= (e.clientY - this.lastPointer.y) / this.zoom;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.hasAnchor = false;
    this.clampScroll();
    this.applyTransform();
  };
  private onPointerUp = () => {
    this.dragging = false;
  };

  private constructor(app: Application, world: Container, opts: PixiWorldOptions) {
    this.app = app;
    this.world = world;
    this.opts = opts;
    this.worldW = opts.map.width * TILE_SIZE;
    this.worldH = opts.map.height * TILE_SIZE;
  }

  static async create(opts: PixiWorldOptions): Promise<PixiWorld> {
    const app = new Application();
    await app.init({
      resizeTo: opts.container,
      backgroundColor: 0x151a26,
      antialias: false,
      roundPixels: true,
    });
    opts.container.appendChild(app.canvas);

    const world = new Container();
    app.stage.addChild(world);

    const instance = new PixiWorld(app, world, opts);
    instance.build();
    instance.setupInput();
    instance.recomputeMinZoom();
    const startZoom = Math.max(instance.minZoom, DEFAULT_ZOOM);
    instance.zoom = startZoom;
    instance.targetZoom = startZoom;
    instance.centerCamera();
    app.ticker.add((ticker) => instance.tick(ticker.deltaMS));
    return instance;
  }

  private build(): void {
    const { map, theme } = this.opts;
    const floorLayer = new Container();
    const wallLayer = new Container();
    const decorationLayer = new Container();
    const furnitureLayer = new Container();
    furnitureLayer.sortableChildren = true;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const floorTile = map.floor[y][x] as Tile;
        if (floorTile !== Tile.Void) {
          const floorSprite = new Sprite(getTileTexture(theme, floorTile));
          floorSprite.x = x * TILE_SIZE;
          floorSprite.y = y * TILE_SIZE;
          floorLayer.addChild(floorSprite);
        }

        const wallTile = map.walls[y][x];
        if (wallTile >= 0) {
          const wallSprite = new Sprite(getTileTexture(theme, wallTile as Tile));
          wallSprite.x = x * TILE_SIZE;
          wallSprite.y = y * TILE_SIZE;
          wallLayer.addChild(wallSprite);
        }
      }
    }

    for (const d of map.decoration) {
      const sprite = new Sprite(getPropTexture(theme, d.prop));
      sprite.anchor.set(0.5, 1);
      sprite.x = (d.tx + 0.5) * TILE_SIZE;
      sprite.y = (d.ty + 1) * TILE_SIZE;
      if (d.flip) sprite.scale.x = -1;
      decorationLayer.addChild(sprite);
    }

    for (const f of map.furniture) {
      const sprite = new Sprite(getPropTexture(theme, f.prop));
      sprite.anchor.set(0.5, 1);
      sprite.x = (f.tx + 0.5) * TILE_SIZE;
      sprite.y = (f.ty + 1) * TILE_SIZE;
      if (f.flip) sprite.scale.x = -1;
      sprite.zIndex = sprite.y;
      furnitureLayer.addChild(sprite);
    }

    this.world.addChild(floorLayer, wallLayer, decorationLayer, furnitureLayer);
  }

  private setupInput(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.app.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private toCanvasPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private recomputeMinZoom(): void {
    this.minZoom = Math.max(
      this.app.screen.width / this.worldW,
      this.app.screen.height / this.worldH,
    );
    if (this.targetZoom < this.minZoom) this.targetZoom = this.minZoom;
    if (this.zoom < this.minZoom) this.zoom = this.minZoom;
  }

  private centerCamera(): void {
    this.scrollX = (this.worldW - this.app.screen.width / this.zoom) / 2;
    this.scrollY = (this.worldH - this.app.screen.height / this.zoom) / 2;
    this.applyTransform();
  }

  private clampScroll(): void {
    const viewW = this.app.screen.width / this.zoom;
    const viewH = this.app.screen.height / this.zoom;
    const maxX = Math.max(0, this.worldW - viewW);
    const maxY = Math.max(0, this.worldH - viewH);
    this.scrollX = maxX > 0 ? Math.max(0, Math.min(maxX, this.scrollX)) : maxX / 2;
    this.scrollY = maxY > 0 ? Math.max(0, Math.min(maxY, this.scrollY)) : maxY / 2;
  }

  private applyTransform(): void {
    this.world.scale.set(this.zoom);
    this.world.position.set(-this.scrollX * this.zoom, -this.scrollY * this.zoom);
  }

  private tick(deltaMS: number): void {
    this.recomputeMinZoom();

    if (Math.abs(this.targetZoom - this.zoom) > 0.0005) {
      const t = Math.min(1, (deltaMS / 1000) * ZOOM_LERP_SPEED);
      this.zoom += (this.targetZoom - this.zoom) * t;
      if (Math.abs(this.targetZoom - this.zoom) < 0.0005) this.zoom = this.targetZoom;

      if (this.hasAnchor) {
        // Re-solve scroll so the same world point stays under the cursor at the new zoom.
        this.scrollX = this.anchorWorld.x - this.anchorScreen.x / this.zoom;
        this.scrollY = this.anchorWorld.y - this.anchorScreen.y / this.zoom;
      }
      this.clampScroll();
      this.applyTransform();
    }

    const step = (PAN_SPEED * deltaMS) / 1000 / this.zoom;
    let dx = 0;
    let dy = 0;
    if (this.heldKeys.has("ArrowLeft") || this.heldKeys.has("KeyA")) dx -= step;
    if (this.heldKeys.has("ArrowRight") || this.heldKeys.has("KeyD")) dx += step;
    if (this.heldKeys.has("ArrowUp") || this.heldKeys.has("KeyW")) dy -= step;
    if (this.heldKeys.has("ArrowDown") || this.heldKeys.has("KeyS")) dy += step;
    if (dx !== 0 || dy !== 0) {
      this.hasAnchor = false;
      this.scrollX += dx;
      this.scrollY += dy;
      this.clampScroll();
      this.applyTransform();
    }
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.app.canvas.removeEventListener("wheel", this.onWheel);
    this.app.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.app.destroy(true, { children: true, texture: false });
  }
}
