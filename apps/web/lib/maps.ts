/** The maps the game client ships (apps/frontend/src/game/map/themes.ts). The
 *  game deep-links in via `/?map=<key>`, so "Enter office" navigates there. */

export type MapTheme = "slate" | "maple" | "midnight" | "evergreen";

export type GameMap = {
  key: MapTheme;
  name: string;
  description: string;
};

export const MAPS: GameMap[] = [
  { key: "slate", name: "Slate & Oak", description: "Concrete floors, white desk pods and a warm oak lounge." },
  { key: "maple", name: "Warm Maple", description: "Cream tiles and honey-wood desks throughout." },
  { key: "midnight", name: "Midnight Ops", description: "Dark floors, glowing screens — built for night owls." },
  { key: "evergreen", name: "Evergreen Studio", description: "Sage floors, green walls and plants everywhere." },
];

/** Where the PixiJS game client is served. Override per-env if needed. */
export const GAME_URL = process.env.NEXT_PUBLIC_GAME_URL ?? "http://localhost:5173";

/** Divyam's login page lives in the game client (src/ui/auth). "Log in" in the
 *  navbar sends signed-out users there; `?login` forces the sign-in screen even
 *  if the game still holds a stale session. */
export const LOGIN_URL = process.env.NEXT_PUBLIC_LOGIN_URL ?? `${GAME_URL}/?login=1`;

/** Leave the lobby and open the chosen map in the game client. */
export function enterMap(key: MapTheme): void {
  window.location.href = `${GAME_URL}/?map=${encodeURIComponent(key)}`;
}
