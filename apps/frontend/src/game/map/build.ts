import { compileOfficeMap, type OfficeMapData } from "./schema";
import { OFFICE_LAYOUTS } from "./officeLayouts";
import type { OfficeTheme } from "./themes";

/**
 * Each theme now owns its own structurally distinct floor plan (see
 * officeLayouts.ts) — palette and layout are paired 1:1, not mixed and
 * matched, so each is compiled and cached independently.
 */
const cache = new Map<string, OfficeMapData>();

export function getOfficeMap(theme: OfficeTheme): OfficeMapData {
  let parsed = cache.get(theme.key);
  if (!parsed) {
    const raw = OFFICE_LAYOUTS[theme.key];
    if (!raw) throw new Error(`No layout authored for theme: ${theme.key}`);
    parsed = compileOfficeMap(raw);
    cache.set(theme.key, parsed);
  }
  return parsed;
}
