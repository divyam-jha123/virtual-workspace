import { LogOut } from "lucide";
import { icon } from "./icon";

/** Screen-fixed overlay drawn over the Pixi canvas: title, controls hint, exit button. */
export function renderHud(root: HTMLElement, title: string, onExit: () => void): void {
  root.innerHTML = "";
  root.className = "hud-overlay";

  const titleEl = document.createElement("div");
  titleEl.className = "hud-chip hud-title";
  titleEl.textContent = title;
  root.appendChild(titleEl);

  const hint = document.createElement("div");
  hint.className = "hud-chip hud-hint";
  hint.textContent =
    "WASD / arrows to move · scroll to zoom · ` toggles debug · ESC or Exit to change map";
  root.appendChild(hint);

  const exitBtn = document.createElement("button");
  exitBtn.className = "hud-exit";
  exitBtn.append(icon(LogOut, 15), "Exit");
  exitBtn.addEventListener("click", onExit);
  root.appendChild(exitBtn);
}
