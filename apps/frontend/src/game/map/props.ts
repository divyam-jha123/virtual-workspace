import { Texture } from "pixi.js";
import type { OfficeTheme } from "./themes";
import { TILE_SIZE } from "./tileset";

/**
 * Procedurally drawn office furniture. Desk pods and meeting tables bake
 * desks/chairs into a single sprite — placed as one object and depth-sorted
 * by y. Themed props take their colors from the map's theme; neutral props
 * (appliances, server gear) look the same in every theme.
 */
export type PropType =
  | "pod2"
  | "pod4"
  | "pod6"
  | "deskSolo"
  | "chair"
  | "stool"
  | "boardtable"
  | "meetsmall"
  | "trainpair"
  | "receptiondesk"
  | "rug"
  | "sofa"
  | "sofaV"
  | "sofaCorner"
  | "armchair"
  | "coffeetable"
  | "bookshelf"
  | "counter"
  | "console"
  | "boardgame"
  | "mugshelf"
  | "tv"
  | "plant"
  | "cooler"
  | "cabinet"
  | "printer"
  | "lamp"
  | "whiteboard"
  | "aquarium"
  | "beanbag"
  | "fridge"
  | "coffeemachine"
  | "serverrack"
  | "logomat"
  | "speaker";

/** Non-blocking floor decoration — everything else in FURNITURE blocks. */
export const DECORATION_PROPS: readonly PropType[] = ["plant", "rug", "logomat", "lamp"];

const THEMED: PropType[] = [
  "pod2",
  "pod4",
  "pod6",
  "deskSolo",
  "chair",
  "stool",
  "boardtable",
  "meetsmall",
  "trainpair",
  "receptiondesk",
  "rug",
  "sofa",
  "sofaV",
  "sofaCorner",
  "armchair",
  "coffeetable",
  "bookshelf",
  "counter",
  "console",
  "boardgame",
  "mugshelf",
];

export function propTextureKey(themeKey: string, prop: PropType): string {
  return THEMED.includes(prop) ? `${themeKey}-${prop}` : `prop-${prop}`;
}

/** Pixel size of each prop's baked sprite, used for rendering and to derive its collision footprint. */
export const PROP_SIZE_PX: Record<PropType, [number, number]> = {
  pod2: [128, 48],
  pod4: [128, 80],
  pod6: [128, 112],
  deskSolo: [40, 40],
  chair: [20, 24],
  stool: [18, 20],
  boardtable: [256, 76],
  meetsmall: [128, 68],
  trainpair: [64, 36],
  receptiondesk: [96, 34],
  rug: [64, 40],
  sofa: [56, 28],
  sofaV: [28, 56],
  sofaCorner: [32, 32],
  armchair: [26, 26],
  coffeetable: [30, 20],
  bookshelf: [34, 38],
  counter: [96, 36],
  console: [48, 22],
  boardgame: [36, 30],
  mugshelf: [44, 20],
  tv: [44, 32],
  plant: [22, 30],
  cooler: [18, 30],
  cabinet: [24, 32],
  printer: [26, 22],
  lamp: [18, 36],
  whiteboard: [48, 28],
  aquarium: [48, 36],
  beanbag: [26, 20],
  fridge: [24, 36],
  coffeemachine: [18, 22],
  serverrack: [24, 44],
  logomat: [48, 32],
  speaker: [14, 20],
};

/** Tile footprint used for collision — rounded up from the sprite's pixel size. */
export function propFootprint(prop: PropType): [number, number] {
  const [w, h] = PROP_SIZE_PX[prop];
  return [Math.max(1, Math.round(w / TILE_SIZE)), Math.max(1, Math.round(h / TILE_SIZE))];
}

type Ctx = CanvasRenderingContext2D;

function shadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.20)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, stroke?: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
}

function circle(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}

/** Office chair seen from above; back sits on the outer (facing) side. */
function podChair(ctx: Ctx, x: number, y: number, side: "left" | "right", th: OfficeTheme): void {
  shadow(ctx, x + 10, y + 20, 8, 2.5);
  box(ctx, x + 3, y + 3, 15, 15, th.chair.seat, th.chair.dark);
  ctx.fillStyle = th.chair.dark;
  if (side === "left") ctx.fillRect(x, y + 1, 4, 19);
  else ctx.fillRect(x + 17, y + 1, 4, 19);
}

/** Desk island with `rows` facing pairs — 2*rows seats, chairs baked in. */
function drawPod(ctx: Ctx, rows: number, th: OfficeTheme): void {
  const islandTop = 8;
  const islandH = rows * 32;
  shadow(ctx, 64, islandTop + islandH + 4, 36, 4);
  box(ctx, 34, islandTop, 60, islandH, th.desk.top, th.desk.edge);
  ctx.fillStyle = th.desk.edge;
  ctx.fillRect(63, islandTop, 2, islandH);
  for (let r = 1; r < rows; r++) ctx.fillRect(34, islandTop + r * 32, 60, 1);

  for (let r = 0; r < rows; r++) {
    const y = islandTop + r * 32;
    box(ctx, 50, y + 5, 11, 9, "#22252c");
    ctx.fillStyle = "#7fb6d9";
    ctx.fillRect(52, y + 7, 7, 5);
    box(ctx, 67, y + 5, 11, 9, "#22252c");
    ctx.fillStyle = "#7fb6d9";
    ctx.fillRect(69, y + 7, 7, 5);
    ctx.fillStyle = "#dfe2e8";
    ctx.fillRect(38, y + 19, 10, 4);
    ctx.fillRect(80, y + 19, 10, 4);
    circle(ctx, 43, y + 27, 1.2, "#9aa0aa");
    circle(ctx, 85, y + 27, 1.2, "#9aa0aa");

    podChair(ctx, 8, y + 4, "left", th);
    podChair(ctx, 99, y + 4, "right", th);
  }
}

/** A single desk against the wall: monitor, keyboard and one chair. */
function drawDeskSolo(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 20, 35, 16, 3);
  box(ctx, 4, 4, 32, 16, th.desk.top, th.desk.edge);
  box(ctx, 13, 0, 14, 9, "#22252c");
  ctx.fillStyle = "#7fb6d9";
  ctx.fillRect(15, 2, 10, 5);
  ctx.fillStyle = "#dfe2e8";
  ctx.fillRect(14, 14, 12, 3);
  box(ctx, 9, 22, 22, 15, th.chair.seat, th.chair.dark);
}

/** Standalone office chair, usable anywhere (guest chairs, desk seating). */
function drawChair(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 10, 21, 7, 2.5);
  box(ctx, 3, 3, 14, 15, th.chair.seat, th.chair.dark);
  ctx.fillStyle = th.chair.dark;
  ctx.fillRect(2, 1, 4, 19);
}

/** Small round stool for kitchen islands / bar counters. */
function drawStool(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 9, 17, 7, 2);
  circle(ctx, 9, 9, 8, th.chair.seat);
  circle(ctx, 9, 9, 6, th.chair.dark);
}

/** Shared drawer for meeting-style tables: `perSide` chairs on each long edge. */
function drawMeetingTable(ctx: Ctx, w: number, h: number, perSide: number, th: OfficeTheme): void {
  const tableW = w - 56;
  const tableX = (w - tableW) / 2;
  const spacing = tableW / perSide;
  shadow(ctx, w / 2, h - 8, w / 2 - 8, 5);
  for (const cy of [4, h - 20]) {
    for (let i = 0; i < perSide; i++) {
      const cx = tableX + spacing * i + spacing / 2 - 10;
      box(ctx, cx, cy, 20, 16, th.chair.seat, th.chair.dark);
    }
  }
  box(ctx, tableX, 20, tableW, h - 40, th.wood.base, th.wood.dark);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(tableX + 4, 24, tableW - 8, 3);
  ctx.fillStyle = th.wood.dark;
  ctx.fillRect(tableX + 4, h - 24, tableW - 8, 1);
  ctx.fillStyle = "#dfe2e8";
  ctx.fillRect(w / 2 - 8, h / 2 - 6, 16, 8);
}

/** Training-room pair: a shared table with two chairs on the near side only. */
function drawTrainPair(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 32, 30, 26, 3);
  box(ctx, 4, 8, 56, 14, th.wood.base, th.wood.dark);
  box(ctx, 10, 22, 16, 12, th.chair.seat, th.chair.dark);
  box(ctx, 38, 22, 16, 12, th.chair.seat, th.chair.dark);
}

/** Reception counter with a raised front panel and a small sign/monitor. */
function drawReceptionDesk(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 48, 30, 44, 4);
  box(ctx, 4, 10, 88, 20, th.wood.base, th.wood.dark);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(4, 7, 88, 4);
  box(ctx, 20, 0, 24, 10, "#f4f6f8", "#c7ccd3");
}

/** Flat area rug — rendered as decoration, under furniture. */
function drawRug(ctx: Ctx, th: OfficeTheme): void {
  ctx.fillStyle = th.sofa.cushion;
  ctx.fillRect(2, 2, 60, 36);
  ctx.strokeStyle = th.sofa.dark;
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 56, 32);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(8, 8, 48, 24);
}

function drawSofa(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 28, 26, 25, 3);
  box(ctx, 3, 3, 50, 11, th.sofa.base, th.sofa.dark);
  box(ctx, 1, 8, 7, 15, th.sofa.dark);
  box(ctx, 48, 8, 7, 15, th.sofa.dark);
  box(ctx, 8, 11, 20, 11, th.sofa.cushion, th.sofa.dark);
  box(ctx, 28, 11, 20, 11, th.sofa.cushion, th.sofa.dark);
}

/** Vertical modular sofa segment (back on the left) — pairs with sofaCorner to build L/U groups. */
function drawSofaV(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 15, 51, 11, 3);
  box(ctx, 3, 3, 11, 50, th.sofa.base, th.sofa.dark);
  box(ctx, 1, 1, 15, 7, th.sofa.dark);
  box(ctx, 1, 46, 15, 7, th.sofa.dark);
  box(ctx, 11, 8, 15, 19, th.sofa.cushion, th.sofa.dark);
  box(ctx, 11, 29, 15, 19, th.sofa.cushion, th.sofa.dark);
}

/** Corner piece where a horizontal and vertical sofa run meet. */
function drawSofaCorner(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 16, 28, 13, 3);
  box(ctx, 2, 2, 28, 10, th.sofa.base, th.sofa.dark);
  box(ctx, 2, 2, 10, 28, th.sofa.base, th.sofa.dark);
  box(ctx, 10, 10, 20, 20, th.sofa.cushion, th.sofa.dark);
}

/** Low media console/credenza a TV sits on. */
function drawConsole(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 24, 20, 22, 3);
  box(ctx, 2, 6, 44, 14, th.wood.base, th.wood.dark);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(2, 4, 44, 3);
  ctx.fillStyle = th.wood.dark;
  ctx.fillRect(14, 10, 4, 6);
  ctx.fillRect(30, 10, 4, 6);
}

/** Square table with a checkered board-game top and a couple of pieces. */
function drawBoardgame(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 18, 32, 15, 3);
  box(ctx, 2, 2, 32, 26, th.wood.base, th.wood.dark);
  const cell = 4;
  for (let ry = 0; ry < 5; ry++) {
    for (let rx = 0; rx < 5; rx++) {
      ctx.fillStyle = (rx + ry) % 2 === 0 ? "#e8d9b0" : "#8a6a3f";
      ctx.fillRect(6 + rx * cell, 6 + ry * cell, cell, cell);
    }
  }
  circle(ctx, 10, 14, 1.5, "#c0563e");
  circle(ctx, 22, 20, 1.5, "#3f6fb5");
}

/** Wall shelf behind a coffee bar counter, stocked with mugs and jars. */
function drawMugShelf(ctx: Ctx, th: OfficeTheme): void {
  box(ctx, 2, 4, 40, 14, th.wood.base, th.wood.dark);
  const mugColors = ["#ffffff", "#e0b13e", "#c0563e", "#3f6fb5", "#3f9a4b"];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = mugColors[i % mugColors.length];
    ctx.fillRect(4 + i * 6, 7, 4, 6);
  }
  ctx.fillStyle = th.wood.dark;
  ctx.fillRect(2, 17, 40, 2);
}

function drawArmchair(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 13, 24, 11, 3);
  box(ctx, 3, 3, 20, 11, th.sofa.base, th.sofa.dark);
  box(ctx, 1, 9, 5, 13, th.sofa.dark);
  box(ctx, 20, 9, 5, 13, th.sofa.dark);
  box(ctx, 6, 12, 14, 9, th.sofa.cushion, th.sofa.dark);
}

function drawCoffeeTable(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 15, 18, 12, 2.5);
  box(ctx, 3, 6, 24, 9, th.wood.base, th.wood.dark);
  ctx.fillStyle = th.wood.dark;
  ctx.fillRect(5, 15, 3, 3);
  ctx.fillRect(22, 15, 3, 3);
  ctx.fillStyle = "#e4e7eb";
  ctx.fillRect(12, 8, 6, 4);
}

function drawBookshelf(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 17, 35, 14, 3);
  box(ctx, 2, 2, 30, 32, th.wood.base, th.wood.dark);
  const colors = ["#c0563e", "#3f6fb5", "#3f9a4b", "#e0b13e", "#7a4fa0"];
  for (const shelfY of [5, 15, 25] as const) {
    let bx = 5;
    let i = shelfY;
    while (bx < 26) {
      const w = 3 + ((i * 7) % 3);
      const h = 7 + ((i * 5) % 2);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(bx, shelfY + 9 - h, w, h);
      bx += w + 1;
      i++;
    }
    ctx.fillStyle = th.wood.dark;
    ctx.fillRect(3, shelfY + 9, 28, 2);
  }
}

function drawCounter(ctx: Ctx, th: OfficeTheme): void {
  shadow(ctx, 48, 32, 42, 3);
  box(ctx, 2, 12, 92, 16, th.wood.base, th.wood.dark);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(2, 9, 92, 4);
  box(ctx, 10, 0, 15, 11, "#3a3f4a", "#262a32");
  ctx.fillStyle = "#9aa0aa";
  ctx.fillRect(11, 1, 13, 2);
  for (const cx of [40, 50, 60, 70]) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cx, 4, 5, 5);
  }
  ctx.fillStyle = th.wood.dark;
  ctx.fillRect(12, 18, 72, 1);
}

const THEMED_DRAWERS: Record<PropType, (ctx: Ctx, th: OfficeTheme) => void> = {
  pod2: (ctx, th) => drawPod(ctx, 1, th),
  pod4: (ctx, th) => drawPod(ctx, 2, th),
  pod6: (ctx, th) => drawPod(ctx, 3, th),
  deskSolo: drawDeskSolo,
  chair: drawChair,
  stool: drawStool,
  boardtable: (ctx, th) => drawMeetingTable(ctx, 256, 76, 6, th),
  meetsmall: (ctx, th) => drawMeetingTable(ctx, 128, 68, 3, th),
  trainpair: drawTrainPair,
  receptiondesk: drawReceptionDesk,
  rug: drawRug,
  sofa: drawSofa,
  sofaV: drawSofaV,
  sofaCorner: drawSofaCorner,
  armchair: drawArmchair,
  coffeetable: drawCoffeeTable,
  bookshelf: drawBookshelf,
  counter: drawCounter,
  console: drawConsole,
  boardgame: drawBoardgame,
  mugshelf: drawMugShelf,
} as Record<PropType, (ctx: Ctx, th: OfficeTheme) => void>;

const NEUTRAL_DRAWERS: Partial<Record<PropType, (ctx: Ctx) => void>> = {
  tv: (ctx) => {
    shadow(ctx, 22, 29, 14, 2.5);
    ctx.fillStyle = "#3a3f4a";
    ctx.fillRect(14, 24, 16, 4);
    ctx.fillRect(20, 20, 4, 5);
    box(ctx, 2, 0, 40, 21, "#14161b", "#3a3f4a");
    ctx.fillStyle = "#1e2b38";
    ctx.fillRect(5, 3, 34, 15);
    ctx.fillStyle = "#2f4b5e";
    ctx.fillRect(7, 4, 12, 5);
  },
  plant: (ctx) => {
    shadow(ctx, 11, 27, 8, 2.5);
    box(ctx, 6, 19, 10, 8, "#b5563c", "#8e3b28");
    circle(ctx, 11, 10, 7, "#2f8f3b");
    circle(ctx, 6, 14, 4.5, "#35a043");
    circle(ctx, 16, 14, 4.5, "#35a043");
    circle(ctx, 9, 8, 2.5, "#5cc464");
  },
  cooler: (ctx) => {
    shadow(ctx, 9, 28, 7, 2.5);
    box(ctx, 3, 12, 12, 15, "#e8eaee", "#b9bdc6");
    box(ctx, 4, 3, 10, 9, "#9fd4f2", "#6fb3d8");
    ctx.fillStyle = "#d4ecfa";
    ctx.fillRect(6, 4, 2, 6);
    circle(ctx, 6, 16, 1.5, "#4a90c2");
    circle(ctx, 12, 16, 1.5, "#c0563e");
  },
  cabinet: (ctx) => {
    shadow(ctx, 12, 30, 9, 2.5);
    box(ctx, 3, 4, 18, 25, "#8f959f", "#666c76");
    ctx.fillStyle = "#666c76";
    ctx.fillRect(4, 12, 16, 1);
    ctx.fillRect(4, 20, 16, 1);
    ctx.fillStyle = "#e4e7eb";
    ctx.fillRect(10, 7, 4, 2);
    ctx.fillRect(10, 15, 4, 2);
    ctx.fillRect(10, 23, 4, 2);
  },
  printer: (ctx) => {
    shadow(ctx, 13, 20, 10, 2.5);
    box(ctx, 3, 8, 20, 11, "#d8dbe0", "#a7adb6");
    box(ctx, 6, 4, 14, 4, "#b9bec7");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(8, 1, 10, 4);
    circle(ctx, 19, 12, 1.5, "#3f9a4b");
  },
  lamp: (ctx) => {
    shadow(ctx, 9, 33, 6, 2);
    circle(ctx, 9, 8, 8, "rgba(255,214,120,0.25)");
    ctx.fillStyle = "#3a3f4a";
    ctx.fillRect(8, 12, 2, 20);
    ctx.fillRect(4, 31, 10, 2);
    ctx.beginPath();
    ctx.moveTo(3, 12);
    ctx.lineTo(15, 12);
    ctx.lineTo(13, 3);
    ctx.lineTo(5, 3);
    ctx.closePath();
    ctx.fillStyle = "#e8c15a";
    ctx.fill();
    ctx.strokeStyle = "#b5924a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  },
  whiteboard: (ctx) => {
    box(ctx, 2, 2, 44, 24, "#f4f6f8", "#8a9099");
    const notes = ["#ffd257", "#7ec8f0", "#ff8a80", "#8fd08a"];
    notes.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(6 + i * 10, 6, 6, 6);
    });
    ctx.fillStyle = "#8a9099";
    ctx.fillRect(6, 16, 24, 1);
    ctx.fillRect(6, 19, 30, 1);
    ctx.fillRect(6, 22, 18, 1);
  },
  aquarium: (ctx) => {
    shadow(ctx, 24, 33, 20, 3);
    box(ctx, 4, 24, 40, 8, "#6b4726", "#503418");
    box(ctx, 4, 4, 40, 20, "#3f8fd0", "#dfe4ea");
    ctx.fillStyle = "#7cc4ea";
    ctx.fillRect(6, 6, 36, 4);
    circle(ctx, 15, 15, 2, "#ff8a3c");
    circle(ctx, 28, 12, 2, "#ffd257");
    circle(ctx, 35, 17, 2, "#ff8a3c");
    ctx.fillStyle = "#3f9a4b";
    ctx.fillRect(9, 16, 2, 6);
    ctx.fillRect(38, 14, 2, 8);
  },
  beanbag: (ctx) => {
    shadow(ctx, 13, 17, 10, 2.5);
    ctx.fillStyle = "#3d6a99";
    ctx.beginPath();
    ctx.ellipse(13, 10, 12, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a7fb5";
    ctx.beginPath();
    ctx.ellipse(13, 11, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3d6a99";
    ctx.beginPath();
    ctx.ellipse(13, 8, 6, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  fridge: (ctx) => {
    shadow(ctx, 12, 34, 9, 2.5);
    box(ctx, 2, 2, 20, 32, "#e8eaee", "#b9bdc6");
    ctx.fillStyle = "#9aa0aa";
    ctx.fillRect(2, 13, 20, 2);
    ctx.fillStyle = "#5c6371";
    ctx.fillRect(17, 4, 2, 7);
    ctx.fillRect(17, 16, 2, 7);
  },
  coffeemachine: (ctx) => {
    shadow(ctx, 9, 20, 7, 2);
    box(ctx, 2, 4, 14, 14, "#3a3f4a", "#22252c");
    ctx.fillStyle = "#1a1c21";
    ctx.fillRect(4, 6, 10, 4);
    ctx.fillStyle = "#c0563e";
    ctx.fillRect(6, 11, 6, 4);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(4, 17, 10, 2);
  },
  serverrack: (ctx) => {
    shadow(ctx, 12, 44, 10, 3);
    box(ctx, 2, 2, 20, 40, "#1c1e22", "#333740");
    for (let y = 6; y < 38; y += 6) {
      ctx.fillStyle = "#2a2d33";
      ctx.fillRect(3, y, 18, 4);
      ctx.fillStyle = y % 12 === 0 ? "#3fae4c" : "#e0b13e";
      ctx.fillRect(17, y + 1, 2, 2);
    }
  },
  logomat: (ctx) => {
    ctx.fillStyle = "#2b3140";
    ctx.fillRect(2, 2, 44, 28);
    ctx.strokeStyle = "#4a5568";
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, 40, 24);
    ctx.fillStyle = "#7aa2ff";
    circle(ctx, 24, 16, 8, "#7aa2ff");
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("A", 24, 20);
  },
  speaker: (ctx) => {
    shadow(ctx, 7, 17, 5, 2);
    box(ctx, 2, 2, 10, 16, "#22252c", "#111318");
    circle(ctx, 7, 7, 3, "#3a3f4a");
    circle(ctx, 7, 13, 2, "#3a3f4a");
  },
};

const cache = new Map<string, Texture>();

/** Lazily builds (and caches) a prop's texture for the given theme. */
export function getPropTexture(theme: OfficeTheme, prop: PropType): Texture {
  const key = propTextureKey(theme.key, prop);
  let tex = cache.get(key);
  if (tex) return tex;

  const [w, h] = PROP_SIZE_PX[prop];
  const { canvas, ctx } = makeCanvas(w, h);
  if (THEMED.includes(prop)) {
    THEMED_DRAWERS[prop](ctx, theme);
  } else {
    NEUTRAL_DRAWERS[prop]!(ctx);
  }

  tex = Texture.from(canvas);
  tex.source.scaleMode = "nearest"; // crisp pixel art at any zoom
  cache.set(key, tex);
  return tex;
}
