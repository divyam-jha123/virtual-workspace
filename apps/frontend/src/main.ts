import { getTheme } from "./game/map/themes";
import { getOfficeMap } from "./game/map/build";
import { PixiWorld } from "./game/world/PixiWorld";
import { renderMapSelectMenu } from "./game/ui/MapSelectMenu";
import { renderHud } from "./game/ui/Hud";

const root = document.getElementById("app")!;
let world: PixiWorld | null = null;

function showMenu(): void {
  world?.destroy();
  world = null;
  renderMapSelectMenu(root, (themeKey) => void enterWorld(themeKey));
}

async function enterWorld(themeKey: string): Promise<void> {
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
    onExit: showMenu,
  });

  renderHud(hudContainer, map.name, showMenu);
}

// Dev deep-link: /?map=<themeKey> jumps straight into a map.
const themeKey = new URLSearchParams(window.location.search).get("map");
if (themeKey) {
  void enterWorld(themeKey);
} else {
  showMenu();
}
