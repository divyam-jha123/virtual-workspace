import { Spritesheet, Texture } from "pixi.js";

/**
 * Placeholder avatar sprite sheets, generated procedurally so the app ships
 * with zero binary assets. Each sheet uses the classic top-down layout —
 * rows = facing directions, columns = walk-cycle frames — and is parsed into
 * a PixiJS v8 `Spritesheet` with named `walk_<dir>` animations.
 *
 * To swap in real art later, replace `buildCharacterSpritesheet` with
 * `Assets.load('/sprites/<id>.json')` pointing at an atlas that uses the SAME
 * frame size, direction row order and `walk_<dir>` animation names — no other
 * code changes needed.
 */

export const FRAME_W = 32;
export const FRAME_H = 48;
export const WALK_FRAMES = 4;
/** Row order in the generated sheet (and expected in any real sheet). */
export const DIRECTIONS = ["down", "left", "right", "up"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface CharacterDef {
  id: string;
  name: string;
  gender: "male" | "female";
  skin: string;
  hair: string;
  /** long hair falls to the shoulders (used to read as female here) */
  longHair: boolean;
  shirt: string;
  pants: string;
}

export const CHARACTERS: CharacterDef[] = [
  { id: "arjun", name: "Arjun", gender: "male", skin: "#c68642", hair: "#2b1d12", longHair: false, shirt: "#3f6fb5", pants: "#33373f" },
  { id: "leo", name: "Leo", gender: "male", skin: "#f1c39b", hair: "#7a4a1e", longHair: false, shirt: "#4caf50", pants: "#3a3f4a" },
  { id: "kenji", name: "Kenji", gender: "male", skin: "#e8b07d", hair: "#141414", longHair: false, shirt: "#e0b13e", pants: "#2e3138" },
  { id: "marcus", name: "Marcus", gender: "male", skin: "#8d5524", hair: "#0d0d0d", longHair: false, shirt: "#c0563e", pants: "#40454f" },
  { id: "diego", name: "Diego", gender: "male", skin: "#d99a63", hair: "#3a2413", longHair: false, shirt: "#7a4fa0", pants: "#2b2f36" },
  { id: "mira", name: "Mira", gender: "female", skin: "#e8b592", hair: "#5a2d0c", longHair: true, shirt: "#e2568e", pants: "#3a3f4a" },
  { id: "aria", name: "Aria", gender: "female", skin: "#f1c39b", hair: "#e0b13e", longHair: true, shirt: "#3fae9a", pants: "#33373f" },
  { id: "yuki", name: "Yuki", gender: "female", skin: "#f0cba6", hair: "#1a1a1a", longHair: true, shirt: "#8a5cff", pants: "#2e3138" },
  { id: "nadia", name: "Nadia", gender: "female", skin: "#a9663b", hair: "#20140b", longHair: true, shirt: "#e8804b", pants: "#40454f" },
  { id: "sofia", name: "Sofia", gender: "female", skin: "#d99a63", hair: "#7a4a1e", longHair: true, shirt: "#4d8bf0", pants: "#2b2f36" },
];

export const DEFAULT_CHARACTER_ID = CHARACTERS[0].id;

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draws one 32x48 character frame at (ox,oy) for a direction + walk frame.
 * Frame phases: 0 stand, 1 left-foot step, 2 stand, 3 right-foot step — so
 * frame 0 doubles as the idle pose.
 */
export function drawCharacterFrame(
  ctx: Ctx,
  ox: number,
  oy: number,
  def: CharacterDef,
  dir: Direction,
  frame: number,
): void {
  const swing = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const legL = swing * 2;
  const legR = -swing * 2;
  const armL = -swing * 2;
  const armR = swing * 2;

  // ground shadow
  ellipse(ctx, ox + 16, oy + 45, 9, 3, "rgba(0,0,0,0.20)");

  // legs (pants)
  rect(ctx, ox + 10, oy + 33 + Math.max(0, legL), 5, 10 - Math.abs(legL), def.pants);
  rect(ctx, ox + 17, oy + 33 + Math.max(0, legR), 5, 10 - Math.abs(legR), def.pants);

  // back arm (behind torso), skin sleeve
  rect(ctx, ox + 6, oy + 21 + armL, 4, 12, def.shirt);

  // torso (shirt)
  rect(ctx, ox + 8, oy + 20, 16, 15, def.shirt);
  // subtle shading
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.fillRect(ox + 8, oy + 31, 16, 4);

  // front arm
  rect(ctx, ox + 22, oy + 21 + armR, 4, 12, def.shirt);

  // head (skin)
  ellipse(ctx, ox + 16, oy + 14, 8, 8, def.skin);

  // hair + face per facing direction
  drawHairAndFace(ctx, ox, oy, def, dir);
}

function drawHairAndFace(ctx: Ctx, ox: number, oy: number, def: CharacterDef, dir: Direction): void {
  const eye = "#22252c";
  if (dir === "up") {
    // back of head: hair covers everything, no face
    ellipse(ctx, ox + 16, oy + 14, 8.5, 8.5, def.hair);
    if (def.longHair) rect(ctx, ox + 8, oy + 14, 16, 12, def.hair);
    return;
  }

  // top hair cap for all front/side facings
  ellipse(ctx, ox + 16, oy + 11, 8.5, 6, def.hair);
  if (def.longHair) {
    rect(ctx, ox + 7, oy + 11, 3, 13, def.hair);
    rect(ctx, ox + 22, oy + 11, 3, 13, def.hair);
  }

  if (dir === "down") {
    ctx.fillStyle = eye;
    ctx.fillRect(ox + 12, oy + 15, 2, 2);
    ctx.fillRect(ox + 18, oy + 15, 2, 2);
  } else if (dir === "left") {
    if (def.longHair) rect(ctx, ox + 20, oy + 11, 4, 13, def.hair); // hair trails behind
    ctx.fillStyle = eye;
    ctx.fillRect(ox + 11, oy + 15, 2, 2);
    rect(ctx, ox + 8, oy + 14, 2, 3, def.skin); // nose bump
  } else if (dir === "right") {
    if (def.longHair) rect(ctx, ox + 8, oy + 11, 4, 13, def.hair);
    ctx.fillStyle = eye;
    ctx.fillRect(ox + 19, oy + 15, 2, 2);
    rect(ctx, ox + 22, oy + 14, 2, 3, def.skin);
  }
}

/** Builds a parsed v8 Spritesheet with `walk_<dir>` animations for a character. */
export async function buildCharacterSpritesheet(def: CharacterDef): Promise<Spritesheet> {
  const cols = WALK_FRAMES;
  const rows = DIRECTIONS.length;
  const canvas = document.createElement("canvas");
  canvas.width = cols * FRAME_W;
  canvas.height = rows * FRAME_H;
  const ctx = canvas.getContext("2d")!;

  DIRECTIONS.forEach((dir, d) => {
    for (let f = 0; f < cols; f++) {
      drawCharacterFrame(ctx, f * FRAME_W, d * FRAME_H, def, dir, f);
    }
  });

  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";

  const frames: Record<string, unknown> = {};
  const animations: Record<string, string[]> = {};
  DIRECTIONS.forEach((dir, d) => {
    const names: string[] = [];
    for (let f = 0; f < cols; f++) {
      const name = `${dir}${f}`;
      frames[name] = {
        frame: { x: f * FRAME_W, y: d * FRAME_H, w: FRAME_W, h: FRAME_H },
        sourceSize: { w: FRAME_W, h: FRAME_H },
        spriteSourceSize: { x: 0, y: 0, w: FRAME_W, h: FRAME_H },
      };
      names.push(name);
    }
    animations[`walk_${dir}`] = names;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheet = new Spritesheet(texture, { frames, meta: { scale: 1 }, animations } as any);
  await sheet.parse();
  return sheet;
}

/** A single idle-facing-down frame, upscaled, for the selection card preview. */
export function drawCharacterPreview(def: CharacterDef, scale = 3): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W * scale;
  canvas.height = FRAME_H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  drawCharacterFrame(ctx, 0, 0, def, "down", 0);
  return canvas;
}
