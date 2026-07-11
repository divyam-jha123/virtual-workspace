/** Screen-fixed overlay drawn over the Pixi canvas: title, controls hint, exit button. */
export function renderHud(root: HTMLElement, title: string, onExit: () => void): void {
  root.innerHTML = "";
  root.className = "hud-overlay";

  const titleEl = document.createElement("div");
  titleEl.className = "hud-title";
  titleEl.textContent = title;
  root.appendChild(titleEl);

  const hint = document.createElement("div");
  hint.className = "hud-hint";
  hint.textContent =
    "WASD / arrows to move · scroll to zoom · ` toggles debug · ESC or Exit to change map";
  root.appendChild(hint);

  const exitBtn = document.createElement("button");
  exitBtn.className = "hud-exit";
  exitBtn.textContent = "⏻ Exit";
  exitBtn.addEventListener("click", onExit);
  root.appendChild(exitBtn);
}
