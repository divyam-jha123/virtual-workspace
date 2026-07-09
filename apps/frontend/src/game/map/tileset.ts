import { Texture } from "pixi.js";
import { mulberry32 } from "./random";
import type { OfficeTheme } from "./themes";

export const TILE_SIZE = 32;

/** Floor/wall tile kinds. Index into a per-theme texture cache. */
export enum Tile {
  FloorA = 0,
  FloorB = 1,
  WoodA = 2,
  WoodB = 3,
  Wall = 4,
  WallCorner = 5,
  ServerDark = 6,
  TileNeutral = 7,
  Grass = 8,
  /** Non-walkable "outside the building footprint" cell — renders nothing. */
  Void = 9,
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}

function speckled(
  ctx: CanvasRenderingContext2D,
  base: string,
  dark: string,
  light: string,
  seed: number,
): void {
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = rand() < 0.55 ? dark : light;
    ctx.fillRect(Math.floor(rand() * 30), Math.floor(rand() * 30), 2, 2);
  }
}

function wood(ctx: CanvasRenderingContext2D, base: string, seam: string, seed: number): void {
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = seam;
  for (const y of [7, 15, 23, 31]) ctx.fillRect(0, y, TILE_SIZE, 1);
  for (const top of [0, 8, 16, 24]) ctx.fillRect(4 + Math.floor(rand() * 24), top, 1, 7);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let i = 0; i < 6; i++) ctx.fillRect(Math.floor(rand() * 26), Math.floor(rand() * 30), 4, 1);
}

function wall(ctx: CanvasRenderingContext2D, th: OfficeTheme): void {
  ctx.fillStyle = th.wall.face;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = th.wall.top;
  ctx.fillRect(0, 0, TILE_SIZE, 8);
  ctx.fillStyle = th.wall.base;
  ctx.fillRect(0, 29, TILE_SIZE, 3);
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.fillRect(0, 18, TILE_SIZE, 1);
  ctx.fillRect(10, 9, 1, 9);
  ctx.fillRect(22, 19, 1, 10);
}

function wallCorner(ctx: CanvasRenderingContext2D, th: OfficeTheme): void {
  wall(ctx, th);
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(0, 0, 4, TILE_SIZE);
  ctx.fillRect(0, 0, TILE_SIZE, 4);
  ctx.strokeStyle = th.wall.base;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
}

function grass(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  ctx.fillStyle = "#5aa84f";
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = rand() < 0.55 ? "#4d9743" : "#6bbb5c";
    ctx.fillRect(Math.floor(rand() * 30), Math.floor(rand() * 30), 2, 2);
  }
}

function serverDark(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  ctx.fillStyle = "#1b1d22";
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = rand() < 0.6 ? "#222429" : "#15171b";
    ctx.fillRect(Math.floor(rand() * 30), Math.floor(rand() * 30), 2, 2);
  }
}

const cache = new Map<string, Texture>();

/** Lazily builds (and caches) one theme's tile textures. */
export function getTileTexture(theme: OfficeTheme, tile: Tile): Texture {
  const key = `${theme.key}-tile-${tile}`;
  let tex = cache.get(key);
  if (tex) return tex;

  const { canvas, ctx } = makeCanvas(TILE_SIZE, TILE_SIZE);
  switch (tile) {
    case Tile.FloorA:
      speckled(ctx, theme.floor[0], theme.floor[1], theme.floor[2], 11);
      break;
    case Tile.FloorB:
      speckled(ctx, theme.floor[1], theme.floor[1], theme.floor[2], 22);
      break;
    case Tile.WoodA:
      wood(ctx, theme.accentFloor[0], theme.accentFloor[1], 33);
      break;
    case Tile.WoodB:
      wood(ctx, theme.accentFloor[0], theme.accentFloor[1], 44);
      break;
    case Tile.Wall:
      wall(ctx, theme);
      break;
    case Tile.WallCorner:
      wallCorner(ctx, theme);
      break;
    case Tile.ServerDark:
      serverDark(ctx, 66);
      break;
    case Tile.TileNeutral:
      speckled(ctx, "#c7cbd1", "#b9bdc4", "#d3d7dc", 77);
      break;
    case Tile.Grass:
      grass(ctx, 88);
      break;
    case Tile.Void:
      break;
  }

  tex = Texture.from(canvas);
  cache.set(key, tex);
  return tex;
}
