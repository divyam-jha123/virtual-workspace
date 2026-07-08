import { THEMES } from "../map/themes";
import { getOfficeMap } from "../map/build";
import { buildPreviewCanvas } from "./preview";

/** DOM-based map-select screen — plain HTML/CSS, no canvas needed for menu chrome. */
export function renderMapSelectMenu(root: HTMLElement, onSelect: (themeKey: string) => void): void {
  root.innerHTML = "";
  root.className = "menu-screen";

  const heading = document.createElement("h1");
  heading.textContent = "Choose a map";
  root.appendChild(heading);

  const subheading = document.createElement("p");
  subheading.className = "menu-subheading";
  subheading.textContent = "Four different floor plans, each with its own vibe";
  root.appendChild(subheading);

  const grid = document.createElement("div");
  grid.className = "menu-grid";
  root.appendChild(grid);

  for (const theme of THEMES) {
    const map = getOfficeMap(theme);

    const card = document.createElement("button");
    card.className = "menu-card";

    const preview = buildPreviewCanvas(map, theme);
    preview.className = "menu-preview";
    card.appendChild(preview);

    const title = document.createElement("div");
    title.className = "menu-card-title";
    title.textContent = map.name;
    card.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "menu-card-desc";
    desc.textContent = map.description;
    card.appendChild(desc);

    const cta = document.createElement("div");
    cta.className = "menu-card-cta";
    cta.textContent = "Click to enter →";
    card.appendChild(cta);

    card.addEventListener("click", () => onSelect(theme.key));
    grid.appendChild(card);
  }
}
