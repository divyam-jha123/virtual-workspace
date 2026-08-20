import type { AssetPlacement, AssetRecord } from "./types.js";

const PLACEMENTS: AssetPlacement[] = ["floor", "wall", "ceiling", "overlay"];

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function int(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function tags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase());
  const single = str(value);
  return single ? single.split(/[,\s]+/).filter(Boolean).map((t) => t.toLowerCase()) : [];
}

/**
 * Coerces an untrusted record (local file or API payload) into an `AssetRecord`,
 * or returns `null` with the reason. Payloads are data: no field is ever treated
 * as a path or an instruction, and unknown keys are dropped rather than kept.
 */
export function parseAssetRecord(input: unknown, defaults: { tileSize: number }): { record: AssetRecord } | { error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { error: "not a JSON object" };
  const raw = input as Record<string, unknown>;

  const id = str(raw.id);
  if (!id) return { error: "missing \"id\"" };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return { error: `id "${id}" must be alphanumeric with . _ -` };

  const tilesetId = str(raw.tilesetId) ?? str(raw.tileset);
  if (!tilesetId) return { error: `asset "${id}" is missing "tilesetId"` };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tilesetId)) return { error: `asset "${id}" has an unsafe tilesetId "${tilesetId}"` };

  const tileId = int(raw.tileId);
  if (tileId === undefined || tileId < 0) return { error: `asset "${id}" is missing a non-negative "tileId"` };

  const dimensionsRaw = (raw.dimensions ?? {}) as Record<string, unknown>;
  const width = int(dimensionsRaw.width) ?? 1;
  const height = int(dimensionsRaw.height) ?? 1;
  if (width < 1 || height < 1) return { error: `asset "${id}" has non-positive dimensions` };

  const placementRaw = str(raw.placement) as AssetPlacement | undefined;
  const placement: AssetPlacement = placementRaw && PLACEMENTS.includes(placementRaw) ? placementRaw : "floor";

  const collisionRaw = raw.collision as Record<string, unknown> | undefined;
  const boxRaw = collisionRaw?.box as Record<string, unknown> | undefined;

  const interactionRaw = raw.interaction as Record<string, unknown> | undefined;
  const interactionClass = str(interactionRaw?.class);

  const sourceRaw = raw.source as Record<string, unknown> | undefined;

  const record: AssetRecord = {
    id,
    name: str(raw.name) ?? id,
    category: str(raw.category) ?? "uncategorized",
    tags: tags(raw.tags),
    tileSize: int(raw.tileSize) ?? defaults.tileSize,
    dimensions: { width, height },
    placement,
    tilesetId,
    tileId,
  };

  const subcategory = str(raw.subcategory);
  if (subcategory) record.subcategory = subcategory;
  const style = str(raw.style);
  if (style) record.style = style;
  const version = str(raw.version) ?? (int(raw.version) !== undefined ? String(int(raw.version)) : undefined);
  if (version) record.version = version;

  if (collisionRaw) {
    record.collision = { blocking: collisionRaw.blocking === true };
    const x = int(boxRaw?.x);
    const y = int(boxRaw?.y);
    const bw = int(boxRaw?.width);
    const bh = int(boxRaw?.height);
    if (x !== undefined && y !== undefined && bw !== undefined && bh !== undefined) {
      record.collision.box = { x, y, width: bw, height: bh };
    }
  }

  if (interactionClass) {
    const { class: _ignored, ...rest } = interactionRaw as Record<string, unknown>;
    record.interaction = { class: interactionClass, ...rest };
  }

  if (sourceRaw) {
    const source: NonNullable<AssetRecord["source"]> = {};
    const author = str(sourceRaw.author);
    if (author) source.author = author;
    const license = str(sourceRaw.license);
    if (license) source.license = license;
    const url = str(sourceRaw.url);
    // Kept for attribution only. Nothing in this server ever fetches it.
    if (url) source.url = url;
    if (Object.keys(source).length > 0) record.source = source;
  }

  return { record };
}
