import type { AssetQuery, AssetRecord } from "./types.js";

/** Small synonym table so "table" finds a desk and "sofa" finds a couch. */
const SYNONYMS: Record<string, string[]> = {
  desk: ["table", "workstation", "workdesk"],
  table: ["desk"],
  chair: ["seat", "stool", "deskchair"],
  seat: ["chair", "stool", "sofa"],
  sofa: ["couch", "settee"],
  couch: ["sofa"],
  plant: ["tree", "greenery", "foliage"],
  lamp: ["light", "lighting"],
  wall: ["partition", "divider"],
  door: ["doorway", "entrance"],
  screen: ["monitor", "display", "tv"],
  rug: ["carpet", "mat"],
};

/**
 * Query text -> the terms a source should match, synonyms included.
 *
 * This lives above the transport on purpose: the local repository matches these
 * terms itself and the HTTP repository sends them as `q`, so "table" finds a desk
 * whichever source answered. Expanding in only one of them is exactly the kind of
 * divergence the shared contract suite exists to catch.
 */
export function expandQueryTerms(query: string): string[] {
  const base = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const expanded = new Set(base);
  for (const term of base) for (const synonym of SYNONYMS[term] ?? []) expanded.add(synonym);
  return [...expanded];
}

function haystack(record: AssetRecord): string {
  return [record.id, record.name, record.category, record.subcategory ?? "", record.style ?? "", ...record.tags]
    .join(" ")
    .toLowerCase();
}

/** Hard filters — a record that fails any of these is not a candidate at all. */
export function matches(record: AssetRecord, query: AssetQuery): boolean {
  if (query.category && record.category.toLowerCase() !== query.category.toLowerCase()) return false;
  if (query.style && (record.style ?? "").toLowerCase() !== query.style.toLowerCase()) return false;
  if (query.placement && record.placement !== query.placement) return false;
  if (query.tilesetId && record.tilesetId !== query.tilesetId) return false;
  if (query.tileSize !== undefined && record.tileSize !== query.tileSize) return false;
  if (query.maxWidth !== undefined && record.dimensions.width > query.maxWidth) return false;
  if (query.maxHeight !== undefined && record.dimensions.height > query.maxHeight) return false;

  if (query.query && query.query.trim() !== "") {
    const text = haystack(record);
    return expandQueryTerms(query.query).some((term) => text.includes(term));
  }
  return true;
}

export function score(record: AssetRecord, query: AssetQuery): number {
  if (!query.query || query.query.trim() === "") return 0;
  const wanted = expandQueryTerms(query.query);
  const name = record.name.toLowerCase();
  const tagSet = new Set(record.tags);
  let total = 0;

  for (const term of wanted) {
    if (record.id.toLowerCase() === term) total += 12;
    if (tagSet.has(term)) total += 6;
    if (name === term) total += 8;
    else if (name.startsWith(term)) total += 4;
    else if (name.includes(term)) total += 2;
    if (record.category.toLowerCase() === term) total += 3;
    if (record.subcategory?.toLowerCase() === term) total += 3;
  }
  // Prefer compact assets: a 1x1 chair beats a 6x4 pod for a vague query.
  total -= Math.log2(record.dimensions.width * record.dimensions.height + 1);
  return total;
}

export function rank(records: AssetRecord[], query: AssetQuery): AssetRecord[] {
  return records
    .map((record) => ({ record, score: score(record, query) }))
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))
    .map((entry) => entry.record);
}
