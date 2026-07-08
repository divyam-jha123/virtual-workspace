import { Tile } from "../map/tileset";
import type { OfficeTheme } from "../map/themes";
import type { OfficeMapData } from "../map/schema";
import type { PropType } from "../map/props";

const NEUTRAL_PROP_COLORS: Partial<Record<PropType, string>> = {
  tv: "#14161b",
  plant: "#2f8f3b",
  cooler: "#9fd4f2",
  cabinet: "#8f959f",
  printer: "#d8dbe0",
  lamp: "#e8c15a",
  whiteboard: "#f4f6f8",
  aquarium: "#3f8fd0",
  beanbag: "#4a7fb5",
  fridge: "#e8eaee",
  coffeemachine: "#3a3f4a",
  serverrack: "#2a2d33",
  logomat: "#2b3140",
  speaker: "#22252c",
};

/** 1px-per-tile minimap canvas of the office, tinted with the theme palette. */
export function buildPreviewCanvas(map: OfficeMapData, theme: OfficeTheme): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = map.width;
  canvas.height = map.height;
  const ctx = canvas.getContext("2d")!;

  const groundColors: Record<number, string> = {
    [Tile.FloorA]: theme.floor[0],
    [Tile.FloorB]: theme.floor[1],
    [Tile.WoodA]: theme.accentFloor[0],
    [Tile.WoodB]: theme.accentFloor[0],
    [Tile.ServerDark]: "#1b1d22",
    [Tile.TileNeutral]: "#c7cbd1",
    [Tile.Grass]: "#5aa84f",
    [Tile.Void]: "#151a26",
  };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      ctx.fillStyle = groundColors[map.floor[y][x]] ?? theme.floor[0];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.walls[y][x] >= 0) {
        ctx.fillStyle = theme.wall.base;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  for (const obj of [...map.decoration, ...map.furniture]) {
    ctx.fillStyle = previewColor(obj.prop, theme);
    ctx.fillRect(obj.tx, obj.ty, 1, 1);
  }
  return canvas;
}

function previewColor(prop: PropType, theme: OfficeTheme): string {
  if (prop === "pod2" || prop === "pod4" || prop === "pod6" || prop === "deskSolo") return theme.desk.top;
  if (prop === "chair" || prop === "stool") return theme.chair.seat;
  if (prop === "boardtable" || prop === "meetsmall" || prop === "trainpair" || prop === "receptiondesk")
    return theme.wood.base;
  if (prop === "sofa" || prop === "sofaV" || prop === "sofaCorner" || prop === "armchair")
    return theme.sofa.base;
  if (prop === "coffeetable" || prop === "bookshelf" || prop === "counter" || prop === "console" || prop === "boardgame" || prop === "mugshelf")
    return theme.wood.base;
  if (prop === "rug") return theme.sofa.cushion;
  return NEUTRAL_PROP_COLORS[prop] ?? "#888888";
}
