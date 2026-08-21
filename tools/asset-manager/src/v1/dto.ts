import type { Asset, AssetFile, License, Tag, Tileset } from "@prisma/client";

/** The AssetRecord shape the MCP's parseAssetRecord consumes. Kept structurally
 *  identical to tools/map-mcp/src/services/assets/types.ts — never import across
 *  the tool boundary, just match the shape. */
export interface AssetRecordDto {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  tags: string[];
  style?: string;
  tileSize: number;
  dimensions: { width: number; height: number };
  placement: string;
  tilesetId: string;
  tileId: number;
  collision?: { blocking: boolean; box?: { x: number; y: number; width: number; height: number } };
  interaction?: { class: string; [k: string]: unknown };
  source?: { author?: string; license?: string; url?: string };
  version?: string;
}

export interface TilesetRefDto {
  id: string;
  name?: string;
  version?: string;
  tileSize?: number;
}

export type AssetWithRelations = Asset & {
  tags: Tag[];
  tileset: Tileset | null;
  license: License | null;
};

/** True when a record can actually be placed by the MCP. */
export function isPlaceable(asset: AssetWithRelations): boolean {
  return Boolean(asset.tileset?.key) && asset.tileId !== null && asset.tileId !== undefined;
}

/** Domain Asset -> AssetRecord DTO. Returns null for a non-placeable record so
 *  the MCP never sees unusable art. */
export function toAssetRecord(asset: AssetWithRelations): AssetRecordDto | null {
  if (!asset.tileset?.key || asset.tileId === null || asset.tileId === undefined) return null;

  const record: AssetRecordDto = {
    id: asset.slug,
    name: asset.name,
    category: asset.category,
    tags: asset.tags.map((t) => t.slug),
    tileSize: asset.tileSize,
    dimensions: { width: asset.widthTiles, height: asset.heightTiles },
    placement: asset.placement,
    tilesetId: asset.tileset.key,
    tileId: asset.tileId,
    version: asset.version,
  };
  if (asset.subcategory) record.subcategory = asset.subcategory;
  if (asset.style) record.style = asset.style;

  const collision = asset.collision as AssetRecordDto["collision"] | null;
  if (collision && typeof collision === "object") record.collision = collision;

  const interaction = asset.interaction as AssetRecordDto["interaction"] | null;
  if (interaction && typeof interaction === "object" && interaction.class) record.interaction = interaction;

  const source: NonNullable<AssetRecordDto["source"]> = {};
  if (asset.author) source.author = asset.author;
  if (asset.license?.licenseName ?? asset.license?.name) source.license = asset.license?.licenseName ?? asset.license?.name ?? undefined;
  if (asset.sourceUrl) source.url = asset.sourceUrl;
  if (Object.keys(source).length > 0) record.source = source;

  return record;
}

export function toTilesetRef(tileset: Tileset): TilesetRefDto {
  return {
    id: tileset.key,
    name: tileset.name,
    version: tileset.version,
    tileSize: tileset.tileWidth,
  };
}

export type FileRow = AssetFile;
