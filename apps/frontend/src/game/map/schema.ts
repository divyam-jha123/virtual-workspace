import { Tile } from "./tileset";
import { DECORATION_PROPS, propFootprint, type PropType } from "./props";

/**
 * The renderer consumes only this data — a Tiled-style stack of layers. All
 * room-specific knowledge (what a "boardroom" is) lives in the map builder
 * that produces this object; nothing here or in the renderer special-cases
 * a room type.
 */
export interface PlacedProp {
  prop: PropType;
  /** anchor tile — sprite is anchored bottom-center on this cell */
  tx: number;
  ty: number;
  /** mirror horizontally — lets one sofaV/sofaCorner texture serve both arms of a U/L group */
  flip?: boolean;
}

export interface OfficeMapData {
  key: string;
  name: string;
  description: string;
  width: number;
  height: number;
  /** floor layer: Tile enum value per cell */
  floor: number[][];
  /** wall layer: Tile.Wall / Tile.WallCorner per cell, -1 = no wall */
  walls: number[][];
  /** furniture layer — blocks movement */
  furniture: PlacedProp[];
  /** decoration layer — purely visual, does not block movement */
  decoration: PlacedProp[];
  /** true = blocked. Derived from walls + furniture footprints + void floor. */
  collision: boolean[][];
}

const FURNITURE_CHARS: Record<string, PropType> = {
  "1": "deskSolo",
  "2": "pod2",
  "4": "pod4",
  "6": "pod6",
  B: "boardtable",
  M: "meetsmall",
  N: "trainpair",
  R: "receptiondesk",
  c: "chair",
  o: "stool",
  s: "sofa",
  y: "sofaV",
  x: "sofaCorner",
  a: "armchair",
  t: "coffeetable",
  b: "bookshelf",
  k: "counter",
  n: "console",
  j: "boardgame",
  h: "mugshelf",
  v: "tv",
  w: "cooler",
  f: "cabinet",
  P: "printer",
  e: "whiteboard",
  q: "aquarium",
  g: "beanbag",
  d: "fridge",
  C: "coffeemachine",
  S: "serverrack",
  z: "speaker",
};

const DECORATION_CHARS: Record<string, PropType> = {
  p: "plant",
  u: "rug",
  m: "logomat",
  l: "lamp",
};

/** floor layout chars → Tile enum */
const FLOOR_CHARS: Record<string, Tile> = {
  ".": Tile.FloorA,
  ";": Tile.WoodA,
  ":": Tile.ServerDark,
  _: Tile.TileNeutral,
  "~": Tile.Grass,
  "!": Tile.Void,
};

export interface RawOfficeLayout {
  key: string;
  name: string;
  description: string;
  /** floor chars: '.' open, ';' wood, ':' dark, '_' neutral tile, '~' grass, '!' void (non-walkable, unrendered) */
  floor: string[];
  /** wall chars: '=' wall, 'X' wall corner, anything else = no wall */
  walls: string[];
  /** furniture/decoration chars, see FURNITURE_CHARS / DECORATION_CHARS */
  props: string[];
  /** optional: 'F' at a cell mirrors that cell's prop horizontally (for sofaV/sofaCorner groups) */
  flip?: string[];
}

/** Compiles the hand-authored ASCII layout into the layered OfficeMapData. */
export function compileOfficeMap(raw: RawOfficeLayout): OfficeMapData {
  const height = raw.floor.length;
  const width = Math.max(...raw.floor.map((r) => r.length));

  const floor: number[][] = [];
  const walls: number[][] = [];
  const collision: boolean[][] = [];

  for (let y = 0; y < height; y++) {
    const floorRow = raw.floor[y].padEnd(width, ".");
    const wallRow = (raw.walls[y] ?? "").padEnd(width, ".");
    const fr: number[] = [];
    const wr: number[] = [];
    const cr: boolean[] = [];
    for (let x = 0; x < width; x++) {
      const wch = wallRow[x];
      const fch = floorRow[x];
      fr.push(FLOOR_CHARS[fch] ?? Tile.FloorA);
      if (wch === "=") {
        wr.push(Tile.Wall);
        cr.push(true);
      } else if (wch === "X") {
        wr.push(Tile.WallCorner);
        cr.push(true);
      } else {
        wr.push(-1);
        cr.push(fch === "!");
      }
    }
    floor.push(fr);
    walls.push(wr);
    collision.push(cr);
  }

  const furniture: PlacedProp[] = [];
  const decoration: PlacedProp[] = [];

  for (let y = 0; y < Math.min(raw.props.length, height); y++) {
    const row = raw.props[y];
    const flipRow = raw.flip?.[y] ?? "";
    for (let x = 0; x < Math.min(row.length, width); x++) {
      const ch = row[x];
      const flip = flipRow[x] === "F";
      const furProp = FURNITURE_CHARS[ch];
      const decProp = DECORATION_CHARS[ch];
      if (furProp) {
        furniture.push({ prop: furProp, tx: x, ty: y, flip });
        markFootprint(collision, furProp, x, y, width, height);
      } else if (decProp) {
        decoration.push({ prop: decProp, tx: x, ty: y, flip });
      }
    }
  }

  return {
    key: raw.key,
    name: raw.name,
    description: raw.description,
    width,
    height,
    floor,
    walls,
    furniture,
    decoration,
    collision,
  };
}

/** Marks the tile cells a furniture sprite's footprint covers as blocked. */
function markFootprint(
  collision: boolean[][],
  prop: PropType,
  tx: number,
  ty: number,
  width: number,
  height: number,
): void {
  if (DECORATION_PROPS.includes(prop)) return;
  const [fw, fh] = propFootprint(prop);
  const x1 = Math.max(0, tx - Math.floor(fw / 2));
  const x2 = Math.min(width - 1, x1 + fw - 1);
  const y1 = Math.max(0, ty - fh + 1);
  const y2 = Math.min(height - 1, ty);
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) collision[y][x] = true;
  }
}
