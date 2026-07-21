import "@fontsource-variable/inter";
import { getTheme } from "./game/map/themes";
import { getOfficeMap } from "./game/map/build";
import { PixiWorld } from "./game/world/PixiWorld";
import { renderMapSelectMenu } from "./game/ui/MapSelectMenu";
import { renderCharacterSelect, getSavedCharacterId, getSavedName } from "./game/ui/CharacterSelect";
import { renderHud } from "./game/ui/Hud";
import { PresenceList } from "./ui/presence/PresenceList";
import { DEFAULT_CHARACTER_ID } from "./game/entities/characters";

const root = document.getElementById("app")!;
let world: PixiWorld | null = null;

// Flow: map select → character select → world (with avatar).
function showMenu(): void {
  world?.destroy();
  world = null;
  renderMapSelectMenu(root, (themeKey) => showCharacterSelect(themeKey));
}

function showCharacterSelect(themeKey: string): void {
  renderCharacterSelect(root, {
    initialId: getSavedCharacterId() ?? undefined,
    onBack: showMenu,
    onStart: (characterId, displayName) => void enterWorld(themeKey, characterId, displayName),
  });
}

async function enterWorld(themeKey: string, characterId: string, displayName: string): Promise<void> {
  root.innerHTML = "";

  const worldContainer = document.createElement("div");
  worldContainer.style.width = "100%";
  worldContainer.style.height = "100%";
  root.appendChild(worldContainer);

  const hudContainer = document.createElement("div");
  root.appendChild(hudContainer);

  // Roster panel (#29) — kept in sync from PixiWorld's presence events. Lives in
  // the overlay; cleared when the menu re-renders `root` on exit.
  const presence = new PresenceList();
  root.appendChild(presence.root);

  const theme = getTheme(themeKey);
  const map = getOfficeMap(theme);

  world = await PixiWorld.create({
    container: worldContainer,
    map,
    theme,
    characterId,
    displayName,
    onExit: showMenu,
    onPresenceChange: (entries) => presence.render(entries),
  });

  renderHud(hudContainer, map.name, showMenu);
}

// Dev deep-link: /?map=<themeKey> jumps straight in with the saved character
// and name (&name= overrides, handy for opening two windows as two people).
const params = new URLSearchParams(window.location.search);
const themeKey = params.get("map");
if (themeKey) {
  const name = params.get("name") ?? getSavedName() ?? "Guest";
  void enterWorld(themeKey, getSavedCharacterId() ?? DEFAULT_CHARACTER_ID, name);
} else {
  showMenu();
}
