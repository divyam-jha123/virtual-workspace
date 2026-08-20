/**
 * The ONLY module that knows the asset API's request and response shapes.
 *
 * The real endpoints are not wired yet, so this is written against the assumed
 * contract below and covered by mocked tests. When the live shapes turn out to
 * differ, you change this file and nothing above it:
 *
 *   GET  /assets?q=&category=&style=&placement=&tileset=&tileSize=&limit=
 *        -> { items: AssetDto[], total?: number }   (a bare array is also accepted)
 *   GET  /assets/{id}                  -> AssetDto
 *   GET  /tilesets                     -> { items: TilesetDto[] }
 *   GET  /tilesets/{id}.tsj?version=   -> Tiled tileset JSON
 *   GET  <image path from the .tsj>    -> binary, resolved against the API host
 *
 * Auth: `Authorization: Bearer <ASSET_API_KEY>` plus `X-API-Key`, because APIs
 * disagree about which one they want and sending both is harmless.
 */

import { parseAssetRecord } from "./record.js";
import { expandQueryTerms } from "./search.js";
import type { AssetQuery, AssetRecord, TilesetRef } from "./types.js";

export function searchPath(query: AssetQuery): string {
  const params = new URLSearchParams();
  // `q` carries whitespace-separated terms matched as OR, already synonym-expanded
  // so both asset sources see the same terms.
  if (query.query) params.set("q", expandQueryTerms(query.query).join(" "));
  if (query.category) params.set("category", query.category);
  if (query.style) params.set("style", query.style);
  if (query.placement) params.set("placement", query.placement);
  if (query.tilesetId) params.set("tileset", query.tilesetId);
  if (query.tileSize !== undefined) params.set("tileSize", String(query.tileSize));
  params.set("limit", String(query.limit ?? 25));
  return `/assets?${params.toString()}`;
}

export function assetPath(id: string): string {
  return `/assets/${encodeURIComponent(id)}`;
}

export function tilesetsPath(): string {
  return "/tilesets";
}

export function tilesetPath(id: string, version?: string): string {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
  return `/tilesets/${encodeURIComponent(id)}.tsj${suffix}`;
}

export function authHeaders(apiKey: string | undefined): Record<string, string> {
  if (!apiKey) return {};
  return { authorization: `Bearer ${apiKey}`, "x-api-key": apiKey };
}

/** Pulls the list out of whichever envelope the API used. */
export function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of ["items", "assets", "results", "data", "tilesets"]) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

export function toAssetRecords(payload: unknown, defaults: { tileSize: number }): AssetRecord[] {
  const records: AssetRecord[] = [];
  for (const entry of unwrapList(payload)) {
    const parsed = parseAssetRecord(entry, defaults);
    // A single malformed row from the API must not fail the whole query.
    if ("record" in parsed) records.push(parsed.record);
  }
  return records;
}

export function toAssetRecord(payload: unknown, defaults: { tileSize: number }): AssetRecord | null {
  const body = payload && typeof payload === "object" && "asset" in (payload as object)
    ? (payload as { asset: unknown }).asset
    : payload;
  const parsed = parseAssetRecord(body, defaults);
  return "record" in parsed ? parsed.record : null;
}

export function toTilesetRefs(payload: unknown): TilesetRef[] {
  const refs: TilesetRef[] = [];
  for (const entry of unwrapList(payload)) {
    if (typeof entry === "string") {
      refs.push({ id: entry, vendored: false });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : typeof raw.name === "string" ? raw.name : undefined;
    if (!id) continue;
    const tileSize = typeof raw.tileSize === "number" ? raw.tileSize : typeof raw.tilewidth === "number" ? raw.tilewidth : undefined;
    refs.push({
      id,
      vendored: false,
      ...(typeof raw.name === "string" ? { name: raw.name } : {}),
      ...(typeof raw.version === "string" || typeof raw.version === "number" ? { version: String(raw.version) } : {}),
      ...(tileSize === undefined ? {} : { tileSize }),
    });
  }
  return refs;
}
