import { Application, Container, Sprite } from "pixi.js";
import type { OfficeMapData } from "../map/schema";
import type { OfficeTheme } from "../map/themes";
import { TILE_SIZE, getTileTexture, Tile } from "../map/tileset";
import { getPropTexture } from "../map/props";
import { Camera } from "./Camera";
import { Input } from "../entities/Input";
import { Player } from "../entities/Player";
import { createCollisionMap, getSpawnTile, type CollisionMap } from "../map/collision";
import { buildCharacterSpritesheet, getCharacter } from "../entities/characters";

const MAX_ZOOM = 4;
/**
 * Default opening zoom, as a multiple of the fit-to-screen minimum: 1.0 would
 * show the whole floor exactly; 1.25 opens 25% tighter so the avatar reads a
 * bit larger while most of the office is still visible. The camera can't go
 * below the fit minimum, so the map always fills the viewport.
 */
const DEFAULT_ZOOM_FACTOR = 1.25;
const PAN_SPEED = 420; // spectate keyboard pan, world px/sec at zoom 1

const SPECTATE_PAN_KEYS = new Set([
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
  /** when set, spawns that avatar and switches to follow-cam "play" mode */
  characterId?: string;
}

/**
 * Renders one OfficeMapData as a layered PixiJS scene (floor → walls →
 * decoration → depth-sorted furniture + player) and runs one of two modes:
 *
 *  - spectate (no character): free camera — WASD/drag pan, pointer-anchored
 *    wheel zoom.
 *  - play (character set): the avatar moves with WASD/arrows, the camera
 *    follows it, and `~` toggles a debug overlay (tile coords + FPS).
 */
export class PixiWorld {
  private app: Application;
  private world: Container;
  private opts: PixiWorldOptions;
  private camera: Camera;
  private furnitureLayer!: Container;

  // spectate state
  private heldPanKeys = new Set<string>();
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  // play state
  private input?: Input;
  private player?: Player;
  private collision?: CollisionMap;
  private debugOn = false;
  private debugEl?: HTMLDivElement;

  private get isPlayMode(): boolean {
    return this.player !== undefined;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      this.opts.onExit();
      return;
    }
    if (e.code === "Backquote") {
      this.toggleDebug();
      return;
    }
    // Spectate pan keys only matter without an avatar (Input owns them in play mode).
    if (!this.isPlayMode && SPECTATE_PAN_KEYS.has(e.code)) this.heldPanKeys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.heldPanKeys.delete(e.code);
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.isPlayMode) {
      this.camera.nudgeZoom(e.deltaY);
    } else {
      const { x, y } = this.toCanvasPoint(e.clientX, e.clientY);
      this.camera.zoomAt(e.deltaY, x, y);
    }
  };
  private onPointerDown = (e: PointerEvent) => {
    if (this.isPlayMode) return; // camera is locked to the avatar
    this.dragging = true;
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.camera.moveScroll(
      -(e.clientX - this.lastPointer.x) / this.camera.zoom,
      -(e.clientY - this.lastPointer.y) / this.camera.zoom,
    );
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };
  private onPointerUp = () => {
    this.dragging = false;
  };

  private constructor(app: Application, world: Container, opts: PixiWorldOptions) {
    this.app = app;
    this.world = world;
    this.opts = opts;
    const worldW = opts.map.width * TILE_SIZE;
    const worldH = opts.map.height * TILE_SIZE;
    this.camera = new Camera(worldW, worldH, app.screen.width, app.screen.height, MAX_ZOOM, 0);
    this.camera.setZoomFromFit(DEFAULT_ZOOM_FACTOR);
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
    if (opts.characterId) await instance.setupPlayer(opts.characterId);
    instance.setupInput();

    // Frame the camera on the avatar (play) or the map center (spectate).
    if (instance.player) {
      instance.camera.snapFocus(instance.player.x, instance.player.y - TILE_SIZE / 2);
    } else {
      instance.camera.centerOn(
        (opts.map.width * TILE_SIZE) / 2,
        (opts.map.height * TILE_SIZE) / 2,
      );
    }
    instance.camera.apply(world);

    app.ticker.add((ticker) => instance.tick(ticker.deltaMS, ticker.deltaTime));
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

    this.furnitureLayer = furnitureLayer;
    this.world.addChild(floorLayer, wallLayer, decorationLayer, furnitureLayer);
  }

  private async setupPlayer(characterId: string): Promise<void> {
    const sheet = await buildCharacterSpritesheet(getCharacter(characterId));
    const spawn = getSpawnTile(this.opts.map);
    this.collision = createCollisionMap(this.opts.map);
    this.player = new Player(sheet, spawn.tx, spawn.ty);
    // Same layer as furniture so the avatar depth-sorts behind/in front of props.
    this.furnitureLayer.addChild(this.player.sprite);
    this.input = new Input();
    this.input.attach();
    this.buildDebugOverlay();
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

  private buildDebugOverlay(): void {
    const el = document.createElement("div");
    el.className = "debug-overlay";
    el.style.display = "none";
    this.opts.container.appendChild(el);
    this.debugEl = el;
  }

  private toggleDebug(): void {
    this.debugOn = !this.debugOn;
    if (this.debugEl) this.debugEl.style.display = this.debugOn ? "block" : "none";
  }

  private tick(dtMS: number, deltaTime: number): void {
    this.camera.resize(this.app.screen.width, this.app.screen.height);

    if (this.player && this.input && this.collision) {
      // Single loop, fixed order: input → physics → camera → animation.
      const move = this.input.vector();
      this.player.updatePhysics(deltaTime, dtMS, move, this.collision);
      this.camera.update(dtMS); // ease zoom
      this.camera.follow(this.player.x, this.player.y - TILE_SIZE / 2, deltaTime);
      this.camera.apply(this.world);
      this.player.updateAnimation();
      if (this.debugOn && this.debugEl) {
        this.debugEl.textContent =
          `tile ${this.player.tileX}, ${this.player.tileY}  ·  ` +
          `${Math.round(this.app.ticker.FPS)} fps`;
      }
      return;
    }

    // spectate: keyboard pan
    this.camera.update(dtMS);
    const step = (PAN_SPEED * dtMS) / 1000 / this.camera.zoom;
    let dx = 0;
    let dy = 0;
    if (this.heldPanKeys.has("ArrowLeft") || this.heldPanKeys.has("KeyA")) dx -= step;
    if (this.heldPanKeys.has("ArrowRight") || this.heldPanKeys.has("KeyD")) dx += step;
    if (this.heldPanKeys.has("ArrowUp") || this.heldPanKeys.has("KeyW")) dy -= step;
    if (this.heldPanKeys.has("ArrowDown") || this.heldPanKeys.has("KeyS")) dy += step;
    if (dx !== 0 || dy !== 0) this.camera.moveScroll(dx, dy);
    this.camera.apply(this.world);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.app.canvas.removeEventListener("wheel", this.onWheel);
    this.app.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.input?.detach();
    this.debugEl?.remove();
    this.app.destroy(true, { children: true, texture: false });
  }
}
