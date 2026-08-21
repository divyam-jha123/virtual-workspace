/**
 * The asset seam.
 *
 * `AssetRecord` is the only asset shape that crosses the interface, and nothing
 * above `AssetRepository` handles a filesystem path. Assets live on disk under
 * the workspace `assets/` and `tilesets/` folders; there is no asset database or
 * asset service — the filesystem is the source of truth.
 */

export type AssetPlacement = "floor" | "wall" | "ceiling" | "overlay";

export interface AssetDimensions {
  /** In tiles. */
  width: number;
  height: number;
}

export interface AssetCollision {
  blocking: boolean;
  /** Optional tighter footprint, in tiles, relative to the asset's top-left. */
  box?: { x: number; y: number; width: number; height: number };
}

export interface AssetInteraction {
  /** An object class from the map schema, e.g. "workstation". */
  class: string;
  [key: string]: unknown;
}

export interface AssetSourceInfo {
  author?: string;
  license?: string;
  url?: string;
}

export interface AssetRecord {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  tags: string[];
  style?: string;
  /** Tile size the art was drawn for; must match the map's. */
  tileSize: number;
  dimensions: AssetDimensions;
  placement: AssetPlacement;
  /** With real tilesets every asset resolves through this pair. */
  tilesetId: string;
  tileId: number;
  collision?: AssetCollision;
  interaction?: AssetInteraction;
  source?: AssetSourceInfo;
  version?: string;
}

export interface AssetQuery {
  /** Free text; matched against name, tags, category and id. */
  query?: string;
  category?: string;
  style?: string;
  placement?: AssetPlacement;
  tilesetId?: string;
  /** Only assets drawn for this tile size. */
  tileSize?: number;
  /** Only assets that fit within this footprint, in tiles. */
  maxWidth?: number;
  maxHeight?: number;
  limit?: number;
}

export interface TilesetRef {
  id: string;
  name?: string;
  version?: string;
  tileSize?: number;
  /** Workspace id of the vendored `.tsj`, when one exists locally. */
  path?: string;
  /** True when the file is present in `tilesets/` and usable offline. */
  vendored: boolean;
}

export interface ImageBlob {
  /** Base filename only — never a path; remote-supplied names are sanitized. */
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

/** Opaque tileset JSON; the MCP parses it but never authors it. */
export type TilesetJson = Record<string, unknown>;

export interface AssetRepository {
  /** Human-readable source label, surfaced by `get_project_info`. */
  readonly kind: "local";
  get(id: string): Promise<AssetRecord | null>;
  search(query: AssetQuery): Promise<AssetRecord[]>;
  listTilesets(): Promise<TilesetRef[]>;
  /** Cheap reachability probe. Never throws. */
  health(): Promise<{ reachable: boolean; detail?: string }>;
}
