import { CHARACTERS, drawCharacterPreview } from "../entities/characters";

const STORAGE_KEY = "vw.character";

export interface CharacterSelectOptions {
  /** pre-highlight this character (e.g. the one saved from a previous visit) */
  initialId?: string;
  onBack: () => void;
  onStart: (characterId: string) => void;
}

/**
 * Character selection screen shown before the map loads. Plain DOM (like the
 * map picker): a grid of 10 avatars with idle-facing-down previews; click to
 * select, then Start spawns that avatar. Selection persists to localStorage.
 */
export function renderCharacterSelect(root: HTMLElement, opts: CharacterSelectOptions): void {
  root.innerHTML = "";
  root.className = "menu-screen";

  const back = document.createElement("button");
  back.className = "back-link";
  back.textContent = "← Back to maps";
  back.addEventListener("click", opts.onBack);
  root.appendChild(back);

  const heading = document.createElement("h1");
  heading.textContent = "Choose your character";
  root.appendChild(heading);

  const subheading = document.createElement("p");
  subheading.className = "menu-subheading";
  subheading.textContent = "Pick an avatar — you can move it with WASD or the arrow keys";
  root.appendChild(subheading);

  const grid = document.createElement("div");
  grid.className = "char-grid";
  root.appendChild(grid);

  let selectedId = opts.initialId && CHARACTERS.some((c) => c.id === opts.initialId)
    ? opts.initialId
    : null;
  const cards = new Map<string, HTMLButtonElement>();

  const startBtn = document.createElement("button");
  startBtn.className = "start-btn";
  startBtn.textContent = "Start →";
  startBtn.disabled = selectedId === null;
  startBtn.addEventListener("click", () => {
    if (!selectedId) return;
    localStorage.setItem(STORAGE_KEY, selectedId);
    opts.onStart(selectedId);
  });

  function select(id: string): void {
    selectedId = id;
    for (const [cid, card] of cards) card.classList.toggle("selected", cid === id);
    startBtn.disabled = false;
  }

  for (const def of CHARACTERS) {
    const card = document.createElement("button");
    card.className = "char-card";
    if (def.id === selectedId) card.classList.add("selected");

    const preview = drawCharacterPreview(def, 3);
    preview.className = "char-preview";
    card.appendChild(preview);

    const name = document.createElement("div");
    name.className = "char-name";
    name.textContent = def.name;
    card.appendChild(name);

    card.addEventListener("click", () => select(def.id));
    cards.set(def.id, card);
    grid.appendChild(card);
  }

  const actions = document.createElement("div");
  actions.className = "char-actions";
  actions.appendChild(startBtn);
  root.appendChild(actions);
}

export function getSavedCharacterId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}
