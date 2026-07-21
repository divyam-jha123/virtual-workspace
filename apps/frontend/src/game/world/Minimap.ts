import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture } from "pixi.js";

/** On-screen minimap width (px); the map height preserves the map aspect ratio. */
const WIDTH = 180;
const MARGIN = 16;
/** How far below the top the minimap sits — clears the Exit button. */
const TOP = 56;
const DOT_R = 3;
const LOCAL_COLOR = 0xffffff;
const PEER_COLOR = 0x5cc46a;
const BORDER = 0x2b3140;
const DOT_OUTLINE = 0x14161b;

/** Name list below the map. */
const GAP = 6; // between the map and the name panel
const ROW_H = 17;
const PAD = 7;
const SWATCH_R = 3;
/** Above this many people the list collapses to a count + expand toggle. */
const MAX_VISIBLE = 5;

const NAME_STYLE = new TextStyle({
  fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif",
  fontSize: 11,
  fontWeight: "600",
  fill: "#eaeff9",
});
const HEADER_STYLE = new TextStyle({
  fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif",
  fontSize: 10.5,
  fontWeight: "700",
  fill: "#96a4c4",
});

/** A player the minimap draws: world position + name. Satisfied by Player and
 *  RemotePlayer directly. */
export interface MinimapPlayer {
  readonly worldX: number;
  readonly worldY: number;
  readonly displayName: string;
}

interface RosterEntry {
  name: string;
  color: number;
  isLocal: boolean;
}

/**
 * A screen-fixed minimap pinned to the top-right corner. It lives on the Pixi
 * STAGE (not the world container), so it stays put while the camera pans/zooms.
 * The scaled map (buildPreviewCanvas) is the background; a reused dot marks each
 * player's position (white = local, green = peers). A name list sits below the
 * map; once there are more than MAX_VISIBLE people it collapses to a count with
 * a click-to-expand header.
 */
export class Minimap {
  readonly view = new Container();
  private readonly w = WIDTH;
  private readonly h: number;
  private readonly localDot = new Graphics();
  private readonly peerDots = new Map<string, Graphics>();
  /** Name list below the map; rebuilt only when the roster (or expand state) changes. */
  private readonly names = new Container();
  private readonly namesBg = new Graphics();
  private rosterKey = "";
  private expanded = false;

  constructor(
    background: Texture,
    private readonly worldW: number,
    private readonly worldH: number,
    screenW: number,
  ) {
    this.h = Math.round(WIDTH * (worldH / worldW));

    const bg = new Sprite(background);
    bg.width = this.w;
    bg.height = this.h;
    const frame = new Graphics()
      .roundRect(0, 0, this.w, this.h, 6)
      .stroke({ color: BORDER, width: 2, alpha: 0.9 });
    this.view.addChild(bg, frame);

    this.paintDot(this.localDot, LOCAL_COLOR);
    this.view.addChild(this.localDot);

    this.names.y = this.h + GAP;
    this.names.addChild(this.namesBg);
    this.view.addChild(this.names);

    this.reposition(screenW);
  }

  /** Keep the minimap pinned to the top-right when the viewport resizes. */
  reposition(screenW: number): void {
    this.view.x = screenW - this.w - MARGIN;
    this.view.y = TOP;
  }

  private paintDot(g: Graphics, color: number): void {
    g.clear().circle(0, 0, DOT_R).fill(color).stroke({ color: DOT_OUTLINE, width: 1, alpha: 0.8 });
  }

  /** World px → minimap px (the requested proportional map), clamped to bounds. */
  private place(g: Graphics, worldX: number, worldY: number): void {
    const x = Math.max(0, Math.min(this.w, (worldX / this.worldW) * this.w));
    const y = Math.max(0, Math.min(this.h, (worldY / this.worldH) * this.h));
    g.position.set(x, y);
  }

  /**
   * Refresh every dot + the name list — call once per frame from the ticker.
   * Dot Graphics are reused (created on join, removed on leave, keyed by the
   * same identity as the player-sync `remotes` map); the name list only rebuilds
   * when the roster of names (or the expand toggle) changes.
   */
  updatePlayers(local: MinimapPlayer, remotes: Map<string, MinimapPlayer>): void {
    this.place(this.localDot, local.worldX, local.worldY);

    for (const [id, peer] of remotes) {
      let dot = this.peerDots.get(id);
      if (!dot) {
        dot = new Graphics();
        this.paintDot(dot, PEER_COLOR);
        this.peerDots.set(id, dot);
        this.view.addChildAt(dot, this.view.getChildIndex(this.names));
      }
      this.place(dot, peer.worldX, peer.worldY);
    }

    for (const [id, dot] of this.peerDots) {
      if (!remotes.has(id)) {
        dot.destroy();
        this.peerDots.delete(id);
      }
    }

    this.updateNames(local, remotes);
  }

  /** Expand/collapse the name list (only meaningful when collapsed by count). */
  private toggle = (): void => {
    this.expanded = !this.expanded;
    this.rosterKey = ""; // force a rebuild on the next frame
  };

  /** Rebuild the name panel — you first, then teammates A→Z. Collapses to a
   *  count + toggle once there are more than MAX_VISIBLE people. */
  private updateNames(local: MinimapPlayer, remotes: Map<string, MinimapPlayer>): void {
    const entries: RosterEntry[] = [
      { name: local.displayName, color: LOCAL_COLOR, isLocal: true },
      ...[...remotes.values()].map((p) => ({ name: p.displayName, color: PEER_COLOR, isLocal: false })),
    ].filter((e) => e.name.length > 0);
    entries.sort((a, b) => (a.isLocal !== b.isLocal ? (a.isLocal ? -1 : 1) : a.name.localeCompare(b.name)));

    const n = entries.length;
    const collapsible = n > MAX_VISIBLE;
    const showNames = !collapsible || this.expanded;

    const key = `${n}|${this.expanded}|${entries.map((e) => `${e.isLocal ? "*" : ""}${e.name}`).join("|")}`;
    if (key === this.rosterKey) return;
    this.rosterKey = key;

    this.names.removeChildren();
    this.names.addChild(this.namesBg);

    const rows: Container[] = [];
    if (collapsible) rows.push(this.buildHeader(n));
    if (showNames) for (const e of entries) rows.push(this.buildNameRow(e));

    const height = PAD * 2 + rows.length * ROW_H;
    this.namesBg
      .clear()
      .roundRect(0, 0, this.w, height, 8)
      .fill({ color: 0x12151c, alpha: 0.86 })
      .stroke({ color: BORDER, width: 1, alpha: 0.7 });

    rows.forEach((row, i) => {
      row.y = PAD + i * ROW_H;
      this.names.addChild(row);
    });
  }

  /** Clickable count row: "N in room" + a chevron; toggles the name list. */
  private buildHeader(n: number): Container {
    const row = new Container();
    row.eventMode = "static";
    row.cursor = "pointer";
    row.hitArea = new Rectangle(0, 0, this.w, ROW_H);

    const hover = new Graphics().roundRect(3, 1, this.w - 6, ROW_H - 2, 5).fill({ color: 0xffffff, alpha: 0 });
    row.on("pointerover", () => (hover.alpha = 0.06));
    row.on("pointerout", () => (hover.alpha = 0));
    row.on("pointertap", this.toggle);

    const label = new Text({ text: `${n} in room`, style: HEADER_STYLE, resolution: 3 });
    label.anchor.set(0, 0.5);
    label.position.set(PAD, ROW_H / 2);

    // Chevron: ▸ when collapsed, ▾ when expanded.
    const chevron = new Graphics();
    const cx = this.w - PAD - 3;
    const cy = ROW_H / 2;
    if (this.expanded) chevron.poly([cx - 3, cy - 1, cx + 3, cy - 1, cx, cy + 3]).fill(0x96a4c4);
    else chevron.poly([cx - 1, cy - 3, cx - 1, cy + 3, cx + 3, cy]).fill(0x96a4c4);

    row.addChild(hover, label, chevron);
    return row;
  }

  private buildNameRow(e: RosterEntry): Container {
    const row = new Container();
    const swatch = new Graphics().circle(0, 0, SWATCH_R).fill(e.color);
    swatch.position.set(PAD + SWATCH_R, ROW_H / 2);
    const label = new Text({ text: e.name, style: NAME_STYLE, resolution: 3 });
    label.anchor.set(0, 0.5);
    label.position.set(PAD + SWATCH_R * 2 + 6, ROW_H / 2);
    row.addChild(swatch, label);
    return row;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
