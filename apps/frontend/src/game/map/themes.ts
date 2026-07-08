/**
 * The four workspace maps share one office layout — only the theme (palette
 * and vibe) differs. Every color used by the tileset and prop drawing comes
 * from here.
 */
export interface OfficeTheme {
  key: string;
  name: string;
  description: string;
  /** main open-space floor: base, dark speckle, light speckle */
  floor: [string, string, string];
  /** accent (wood) floor: base, plank seam */
  accentFloor: [string, string];
  wall: { face: string; top: string; base: string };
  desk: { top: string; edge: string };
  chair: { seat: string; dark: string };
  sofa: { base: string; cushion: string; dark: string };
  /** tables, shelves, counters */
  wood: { base: string; dark: string };
  label: string;
}

export const THEMES: OfficeTheme[] = [
  {
    key: "slate",
    name: "Slate & Oak",
    description: "Concrete floors, white desk pods and a warm oak lounge.",
    floor: ["#c3c6cc", "#b6b9c0", "#cfd2d8"],
    accentFloor: ["#c48b58", "#a5714a"],
    wall: { face: "#454b56", top: "#6a7180", base: "#2b2f36" },
    desk: { top: "#f2f3f5", edge: "#b9bdc6" },
    chair: { seat: "#33373f", dark: "#1f2228" },
    sofa: { base: "#d2a24b", cushion: "#e0b45f", dark: "#a87c33" },
    wood: { base: "#8a5f37", dark: "#6b4726" },
    label: "#ffffff",
  },
  {
    key: "maple",
    name: "Warm Maple",
    description: "Cream carpets and maple wood — cosy daylight studio.",
    floor: ["#e6dcc8", "#dbd0ba", "#efe6d4"],
    accentFloor: ["#b57c46", "#96633a"],
    wall: { face: "#7a5f45", top: "#9a7c5c", base: "#54402e" },
    desk: { top: "#faf6ec", edge: "#cbbfa0" },
    chair: { seat: "#4a3f35", dark: "#332b24" },
    sofa: { base: "#5f8f5a", cushion: "#72a36c", dark: "#47703f" },
    wood: { base: "#96633a", dark: "#754c2b" },
    label: "#ffffff",
  },
  {
    key: "midnight",
    name: "Midnight Ops",
    description: "Dark floors, glowing screens — built for night owls.",
    floor: ["#3a3f47", "#333841", "#434955"],
    accentFloor: ["#544869", "#443a55"],
    wall: { face: "#23262c", top: "#3d4149", base: "#141619" },
    desk: { top: "#5b626e", edge: "#3e444e" },
    chair: { seat: "#22252b", dark: "#131519" },
    sofa: { base: "#7a4fa0", cushion: "#8f63b5", dark: "#5c3a7c" },
    wood: { base: "#4a3f55", dark: "#362e40" },
    label: "#dbe2f5",
  },
  {
    key: "evergreen",
    name: "Evergreen Studio",
    description: "Sage floors, green walls and plants everywhere.",
    floor: ["#d3dccf", "#c7d1c3", "#dfe7db"],
    accentFloor: ["#c9a06a", "#a9834f"],
    wall: { face: "#4c6b52", top: "#6b8a70", base: "#33493a" },
    desk: { top: "#f4f6f2", edge: "#bcc6ba" },
    chair: { seat: "#3a4a3d", dark: "#273229" },
    sofa: { base: "#4c8f6b", cushion: "#5fa37e", dark: "#39704f" },
    wood: { base: "#8a5f37", dark: "#6b4726" },
    label: "#ffffff",
  },
];

export function getTheme(key: string): OfficeTheme {
  const theme = THEMES.find((t) => t.key === key);
  if (!theme) throw new Error(`Unknown theme: ${key}`);
  return theme;
}
