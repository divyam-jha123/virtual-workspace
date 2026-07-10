import { getTheme } from "./game/map/themes";
import { getOfficeMap } from "./game/map/build";
import { PixiWorld } from "./game/world/PixiWorld";
import { renderMapSelectMenu } from "./game/ui/MapSelectMenu";
import { renderCharacterSelect, getSavedCharacterId } from "./game/ui/CharacterSelect";
import { renderHud } from "./game/ui/Hud";
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
    onStart: (characterId) => void enterWorld(themeKey, characterId),
  });
}

async function enterWorld(themeKey: string, characterId: string): Promise<void> {
  root.innerHTML = "";

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
    onExit: showMenu,
  });

  renderHud(hudContainer, map.name, showMenu);
}

// Dev deep-link: /?map=<themeKey> jumps straight in with the saved character.
const themeKey = new URLSearchParams(window.location.search).get("map");
if (themeKey) {
  void enterWorld(themeKey, getSavedCharacterId() ?? DEFAULT_CHARACTER_ID);
} else {
  showMenu();
}
