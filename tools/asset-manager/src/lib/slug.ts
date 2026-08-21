/** Lowercase, filename- and id-safe slug. Matches the MCP id charset
 *  (`^[A-Za-z0-9][A-Za-z0-9._-]*$`) after lowercasing. */
export function slugify(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "");
  return cleaned || "untitled";
}

/** A tileset key / .tsj basename: no dots (keeps `basename` resolution clean). */
export function tilesetKey(input: string): string {
  return slugify(input).replace(/\./g, "-") || "tileset";
}
