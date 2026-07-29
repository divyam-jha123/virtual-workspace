import "./styles.css";
import { getTheme } from "./game/map/themes";
import { getOfficeMap } from "./game/map/build";
import { PixiWorld } from "./game/world/PixiWorld";
import { renderMapSelectMenu } from "./game/ui/MapSelectMenu";
import { renderCharacterSelect, getSavedCharacterId } from "./game/ui/CharacterSelect";
import { renderHud } from "./game/ui/Hud";
import { DEFAULT_CHARACTER_ID } from "./game/entities/characters";
import { mountLogin } from "./ui/auth/mountLogin";
import { clearSession, getSession } from "./state/session";

/** The Vorkium lobby/dashboard — where users land after signing in. */
const DASHBOARD_URL =
  (import.meta.env.VITE_DASHBOARD_URL as string | undefined) ?? "http://localhost:3200";

const root = document.getElementById("app")!;
let world: PixiWorld | null = null;
/** Set while the React login screen owns #app; must run before a DOM screen. */
let unmountLogin: (() => void) | null = null;

// Flow: login → map select → character select → world (with avatar).

/** Hand #app back to the plain-DOM screens, tearing down React if it's mounted. */
function releaseRoot(): void {
  unmountLogin?.();
  unmountLogin = null;
}

function showLogin(): void {
  world?.destroy();
  world = null;
  releaseRoot();
  // After a successful sign-in, hand off to the lobby/dashboard.
  unmountLogin = mountLogin(root, () => {
    window.location.href = DASHBOARD_URL;
  });
}

/** Sign out, or recover from a session the backend no longer accepts. */
function signOut(): void {
  clearSession();
  showLogin();
}

function showMenu(): void {
  world?.destroy();
  world = null;
  releaseRoot();
  renderMapSelectMenu(root, (themeKey) => showCharacterSelect(themeKey));
}

/** Leave the world and return to the lobby/dashboard (the hub). */
function goToDashboard(): void {
  window.location.href = DASHBOARD_URL;
}

function showCharacterSelect(themeKey: string): void {
  renderCharacterSelect(root, {
    initialId: getSavedCharacterId() ?? undefined,
    onBack: showMenu,
    onStart: (characterId) => void enterWorld(themeKey, characterId),
  });
}

async function enterWorld(themeKey: string, characterId: string): Promise<void> {
  const session = getSession();
  // The token expires; landing here signed out means the session lapsed.
  if (!session) return signOut();

  releaseRoot();
  root.innerHTML = "";
  root.className = "";

  const worldContainer = document.createElement("div");
  worldContainer.style.width = "100%";
  worldContainer.style.height = "100%";
  root.appendChild(worldContainer);

  const hudContainer = document.createElement("div");
  root.appendChild(hudContainer);

  const theme = getTheme(themeKey);
  const map = getOfficeMap(theme);

  world = await PixiWorld.create({
    container: worldContainer,
    map,
    theme,
    characterId,
    displayName: session.name,
    onExit: goToDashboard,
  });

  renderHud(hudContainer, map.name, goToDashboard, signOut);
}

// Dev deep-link: /?map=<themeKey> jumps straight in with the saved character.
// Still requires a session — the token endpoint is authenticated.
const params = new URLSearchParams(window.location.search);
const themeKey = params.get("map");
if (params.has("login")) {
  // The lobby's "Log in" links here with ?login to force the sign-in screen,
  // even if a stale session exists.
  signOut();
} else if (!getSession()) {
  showLogin();
} else if (themeKey) {
  void enterWorld(themeKey, getSavedCharacterId() ?? DEFAULT_CHARACTER_ID);
} else {
  showMenu();
}
