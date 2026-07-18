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
  unmountLogin = mountLogin(root, () => showMenu());
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
    onExit: showMenu,
  });

  renderHud(hudContainer, map.name, showMenu, signOut);
}

// Dev deep-link: /?map=<themeKey> jumps straight in with the saved character.
// Still requires a session — the token endpoint is authenticated.
const params = new URLSearchParams(window.location.search);
const themeKey = params.get("map");
if (!getSession()) {
  showLogin();
} else if (themeKey) {
  void enterWorld(themeKey, getSavedCharacterId() ?? DEFAULT_CHARACTER_ID);
} else {
  showMenu();
}
