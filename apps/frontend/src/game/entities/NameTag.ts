import { Container, Graphics, Text, TextStyle } from "pixi.js";

/** How far above the avatar's feet the pill floats. Sprites are 48px tall and
 *  anchored at the feet, so this sits just above the head. */
const OFFSET_Y = -52;
const PAD_X = 7;
const PAD_Y = 3;
const DOT_R = 3;
/** Horizontal room reserved for the "you" dot (dot + gap). */
const DOT_SLOT = DOT_R * 2 + 4;

const STYLE = new TextStyle({
  fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 11,
  fontWeight: "bold",
  fill: "#ffffff",
});

export interface NameTagOptions {
  /** When set, a small dot of this color is drawn before the name (marks "you"). */
  dotColor?: number;
}

/**
 * A rounded "pill" label that floats above an avatar's head (Gather-style).
 *
 * `view` is added as a CHILD of the avatar's sprite, so it follows the avatar
 * and depth-sorts with it for free — including while seated, where only the
 * sprite moves. The pill background resizes to fit whatever name is set.
 */
export class NameTag {
  readonly view = new Container();
  private readonly bg = new Graphics();
  private readonly label: Text;
  private readonly dot?: Graphics;

  constructor(name: string, opts: NameTagOptions = {}) {
    this.view.y = OFFSET_Y;
    this.view.addChild(this.bg);

    if (opts.dotColor !== undefined) {
      this.dot = new Graphics().circle(0, 0, DOT_R).fill(opts.dotColor);
      this.view.addChild(this.dot);
    }

    this.label = new Text({ text: name, style: STYLE });
    this.label.anchor.set(0, 0.5);
    this.label.resolution = 3; // stays crisp when the camera is zoomed in
    this.view.addChild(this.label);

    this.redraw();
  }

  /** Set/correct the name; the pill resizes and hides itself when empty. */
  setText(name: string): void {
    if (this.label.text === name) return;
    this.label.text = name;
    this.redraw();
  }

  private redraw(): void {
    const empty = this.label.text.trim().length === 0;
    this.view.visible = !empty;
    if (empty) return;

    const dotW = this.dot ? DOT_SLOT : 0;
    const w = PAD_X * 2 + dotW + this.label.width;
    const h = PAD_Y * 2 + 12;

    // Pill centered on x=0, its bottom edge at y=0 (so it floats above the head).
    this.bg
      .clear()
      .roundRect(-w / 2, -h, w, h, h / 2)
      .fill({ color: 0x12151c, alpha: 0.9 })
      .stroke({ color: 0x2b3140, width: 1, alpha: 0.85 });

    const left = -w / 2 + PAD_X;
    if (this.dot) {
      this.dot.x = left + DOT_R;
      this.dot.y = -h / 2;
    }
    this.label.x = left + dotW;
    this.label.y = -h / 2;
  }
}
