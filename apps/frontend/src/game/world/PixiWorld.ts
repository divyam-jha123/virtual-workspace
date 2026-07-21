import { Application, Container, Sprite } from "pixi.js";
import type { OfficeMapData } from "../map/schema";
import type { OfficeTheme } from "../map/themes";
import { TILE_SIZE, getTileTexture, Tile } from "../map/tileset";
import { getPropTexture } from "../map/props";
import { Camera } from "./Camera";
import { Input } from "../entities/Input";
import { Player } from "../entities/Player";
import { createCollisionMap, getSpawnTile, dumpCollisionRegion, type CollisionMap } from "../map/collision";
import { buildCharacterSpritesheet, getCharacter, DEFAULT_CHARACTER_ID, CHARACTERS } from "../entities/characters";
import { ZoneManager } from "../entities/Zones";
import { SeatManager } from "../entities/Seats";
import { RemotePlayer } from "../entities/RemotePlayer";
import { RoomConnection } from "../net/RoomConnection";
import type { Direction } from "../entities/characters";
import type { Spritesheet } from "pixi.js";
import type { PositionMessage } from "protocol";

const LOCAL_ID = "local";

const MAX_ZOOM = 4;
/**
 * Default opening zoom, as a multiple of the fit-to-screen minimum: 1.0 would
 * show the whole floor exactly; 1.4 opens 40% tighter so the avatar reads a
 * bit larger while most of the office is still visible. The camera can't go
 * below the fit minimum, so the map always fills the viewport.
 */
const DEFAULT_ZOOM_FACTOR = 1.4;
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
  /** Name typed at character select — shown above the avatar's head and sent
   *  to peers as the LiveKit participant name. */
  displayName?: string;
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
  private zoneLayer!: Container;

  // spectate state
  private heldPanKeys = new Set<string>();
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  // play state
  private input?: Input;
  private player?: Player;
  private collision?: CollisionMap;
  private zoneManager?: ZoneManager;
  private seatManager?: SeatManager;
  // networking (issue #11): join a LiveKit room, publish our position, render peers.
  private room?: RoomConnection;
  private remotes = new Map<string, RemotePlayer>();
  private remoteLastT = new Map<string, number>();
  /** One spritesheet per character id, so a peer renders as the avatar they chose. */
  private remoteSheets?: Map<string, Spritesheet>;
  /** after sitting, require input to return to zero before a press stands up */
  private sitReleased = false;
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
    // TEMP (issue #37): mic/cam toggles for testing capture+publish. The real
    // mute/camera UI is issue #41; these keys go away when that lands.
    if (this.isPlayMode && this.room) {
      if (e.code === "KeyM") {
        void this.toggleMic();
        return;
      }
      if (e.code === "KeyC") {
        void this.toggleCam();
        return;
      }
    }
    // Spectate pan keys only matter without an avatar (Input owns them in play mode).
    if (!this.isPlayMode && SPECTATE_PAN_KEYS.has(e.code)) this.heldPanKeys.add(e.code);
  };

  /** TEMP (#37): toggle mic and log the outcome — replaced by the HUD UI (#41). */
  private async toggleMic(): Promise<void> {
    const res = await this.room!.setMicEnabled(!this.room!.micOn);
    // eslint-disable-next-line no-console
    console.log(`[media] mic → ${res.on ? "ON" : "OFF"}${res.failure ? ` (${res.failure})` : ""}`);
  }
  private async toggleCam(): Promise<void> {
    const res = await this.room!.setCamEnabled(!this.room!.camOn);
    // eslint-disable-next-line no-console
    console.log(`[media] cam → ${res.on ? "ON" : "OFF"}${res.failure ? ` (${res.failure})` : ""}`);
  }
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

    // Zone outlines sit above the floor/decoration but below characters.
    const zoneLayer = new Container();
    this.furnitureLayer = furnitureLayer;
    this.zoneLayer = zoneLayer;
    this.world.addChild(floorLayer, wallLayer, decorationLayer, zoneLayer, furnitureLayer);
  }

  private async setupPlayer(characterId: string): Promise<void> {
    const sheet = await buildCharacterSpritesheet(getCharacter(characterId));
    const spawn = getSpawnTile(this.opts.map);
    this.collision = createCollisionMap(this.opts.map);
    this.player = new Player(sheet, spawn.tx, spawn.ty, this.opts.displayName ?? "");
    // Same layer as furniture so the avatar depth-sorts behind/in front of props.
    this.furnitureLayer.addChild(this.player.sprite);
    this.input = new Input();
    this.input.attach();

    this.zoneManager = new ZoneManager(this.opts.map);
    this.zoneManager.render(this.zoneLayer);
    this.seatManager = new SeatManager(this.opts.map);

    // Diagnostic: dump the collision grid around the spawn so phantom blocks
    // on walkable floor are visible.
    // eslint-disable-next-line no-console
    console.log(dumpCollisionRegion(this.opts.map, spawn.tx - 8, spawn.ty - 8, spawn.tx + 8, spawn.ty + 8));

    // Networking (#11): a spritesheet per character (so peers render as the
    // avatar THEY picked), then join the room = the map key and sync positions.
    // Best-effort: if the backend/LiveKit is unreachable the game runs solo.
    this.remoteSheets = new Map();
    await Promise.all(
      CHARACTERS.map(async (c) => this.remoteSheets!.set(c.id, await buildCharacterSpritesheet(c))),
    );
    this.room = new RoomConnection(this.opts.map.key, {
      onRemoteMove: (msg, displayName) => this.applyRemoteMove(msg, displayName),
      onRemoteLeave: (id) => this.removeRemote(id),
    });
    this.room.connect().catch((e: unknown) =>
      // eslint-disable-next-line no-console
      console.warn(`[net] running offline (no peers): ${e instanceof Error ? e.message : String(e)}`),
    );

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

  /** Depth bias so a seated avatar sorts correctly against the seat. */
  private seatZBias(facing: Direction): number {
    return facing === "up" ? -8 : 8; // behind an up-facing backrest, in front otherwise
  }

  /** Apply a peer's position update: spawn its avatar on first sight, drop
   *  stale/reordered lossy packets by timestamp, else steer it to the target.
   *  `displayName` is the peer's LiveKit participant name → their name tag; it
   *  can arrive after the first packet, so we keep it up to date. */
  private applyRemoteMove(msg: PositionMessage, displayName?: string): void {
    const lastT = this.remoteLastT.get(msg.identity) ?? 0;
    if (msg.t <= lastT) return; // stale (lossy delivery can reorder)
    this.remoteLastT.set(msg.identity, msg.t);

    const sheets = this.remoteSheets;
    if (!sheets) return;

    let rp = this.remotes.get(msg.identity);
    if (!rp) {
      // The chosen character no longer reaches peers (the backend now sets the
      // participant name from the logged-in user), so peers render as the
      // default until a character transport exists. Tracked separately.
      const cid = DEFAULT_CHARACTER_ID;
      rp = new RemotePlayer(sheets.get(cid)!, cid, msg.x, msg.y, displayName ?? "");
      this.remotes.set(msg.identity, rp);
      this.furnitureLayer.addChild(rp.sprite);
    }
    if (displayName) rp.setDisplayName(displayName);
    rp.setTarget(msg.x, msg.y, msg.facing);
  }

  /** Remove a peer's avatar when they leave the room. */
  private removeRemote(identity: string): void {
    const rp = this.remotes.get(identity);
    if (!rp) return;
    this.furnitureLayer.removeChild(rp.sprite);
    rp.destroy();
    this.remotes.delete(identity);
    this.remoteLastT.delete(identity);
  }

  private nearestWalkableAdjacent(tx: number, ty: number): { x: number; y: number } {
    const col = this.collision!;
    const ring = [
      [0, 1], [0, -1], [1, 0], [-1, 0],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
    for (const [dx, dy] of ring) {
      if (col.isWalkable(tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
    }
    return { x: tx, y: ty };
  }

  private tick(dtMS: number, deltaTime: number): void {
    this.camera.resize(this.app.screen.width, this.app.screen.height);

    if (this.player && this.input && this.collision && this.seatManager && this.zoneManager) {
      // input → (walk / sit-transition) → camera → animation → zones.
      const player = this.player;
      const seats = this.seatManager;
      const move = this.input.vector();
      const moving = move.x !== 0 || move.y !== 0;
      const nowMs = performance.now();

      if (seats.isWalking) {
        player.updatePhysics(deltaTime, dtMS, move, this.collision);
        const seat = seats.trigger(player.tileX, player.tileY, nowMs);
        if (seat) {
          seats.beginSit(seat, player.x, player.y, nowMs);
          player.poseWalk(seat.facing); // glide toward the seat
          this.sitReleased = !moving;
          // eslint-disable-next-line no-console
          console.log(`[seat] ${LOCAL_ID} sitting on ${seat.type} @ ${seat.x},${seat.y} facing ${seat.facing}`);
        } else {
          player.updateAnimation();
        }
      } else if (seats.transitioning) {
        // Ease the avatar into/out of the seat (input locked).
        const sitting = seats.isSitting;
        const step = seats.advance(nowMs);
        player.setPosition(step.x, step.y);
        if (step.done) {
          if (sitting) {
            const seat = seats.currentSeat!;
            const off = seats.offset(seat.type);
            const zRef = seat.sitZ ?? player.y;
            player.sit(seat.facing, off.x, off.y, zRef + this.seatZBias(seat.facing));
            seats.finishSit();
          } else {
            player.stand();
            seats.finishStand(nowMs);
          }
        }
      } else {
        // Seated: a fresh key press (after releasing) begins standing up.
        if (!moving) this.sitReleased = true;
        else if (this.sitReleased) {
          const seat = seats.currentSeat!;
          const spot = this.nearestWalkableAdjacent(seat.x, seat.y);
          player.poseWalk(seat.facing);
          seats.beginStand(player.x, player.y, (spot.x + 0.5) * TILE_SIZE, (spot.y + 1) * TILE_SIZE, nowMs);
          // eslint-disable-next-line no-console
          console.log(`[seat] ${LOCAL_ID} standing up`);
        }
      }

      this.camera.update(dtMS); // ease zoom
      this.camera.follow(player.x, player.y - TILE_SIZE / 2, deltaTime);
      this.camera.apply(this.world);

      this.zoneManager.update(
        [{ id: LOCAL_ID, tileX: player.tileX, tileY: player.tileY }],
        LOCAL_ID,
      );

      // Networking (#11): broadcast our position (throttled) + ease peers along.
      this.room?.publishPosition(player.x, player.y, player.facingDir, nowMs);
      for (const rp of this.remotes.values()) rp.update(deltaTime);

      if (this.debugOn && this.debugEl) {
        this.debugEl.textContent =
          `tile ${player.tileX}, ${player.tileY}` +
          `${seats.isSeated ? " · seated" : seats.transitioning ? " · …" : ""}  ·  ` +
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
    this.room?.disconnect();
    for (const rp of this.remotes.values()) rp.destroy();
    this.remotes.clear();
    this.debugEl?.remove();
    this.app.destroy(true, { children: true, texture: false });
  }
}
