import { Text, TextStyle } from "pixi.js";

/** How far above the avatar's feet the label floats. Sprites are 48px tall and
 *  anchored at the feet, so this sits just above the head. */
const OFFSET_Y = -52;

const STYLE = new TextStyle({
  fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 11,
  fontWeight: "bold",
  fill: "#ffffff",
  // Dark outline so the name stays readable over any floor or furniture.
  stroke: { color: "#14161b", width: 4, join: "round" },
});

/**
 * A display-name label that floats above an avatar's head.
 *
 * It's added as a CHILD of the avatar's sprite, so it follows the avatar and
 * depth-sorts with it for free — including while seated, where only the sprite
 * moves. No per-frame bookkeeping needed.
 */
export function createNameTag(name: string): Text {
  const tag = new Text({ text: name, style: STYLE });
  tag.anchor.set(0.5, 1);
  tag.y = OFFSET_Y;
  tag.resolution = 3; // stays crisp when the camera zooms in
  return tag;
}
