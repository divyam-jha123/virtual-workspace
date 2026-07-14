import { CHARACTERS, drawCharacterPreview } from "../entities/characters";

const STORAGE_KEY = "vw.character";
const NAME_KEY = "vw.name";
/** Keep names short so the tag above the avatar's head stays readable. */
const MAX_NAME = 16;

export interface CharacterSelectOptions {
  /** pre-highlight this character (e.g. the one saved from a previous visit) */
  initialId?: string;
  onBack: () => void;
  onStart: (characterId: string, displayName: string) => void;
}

/**
 * Character selection screen shown before the map loads. Plain DOM (like the
 * map picker): type a display name, pick one of 10 avatars, then Start spawns
 * it. The name is shown above the avatar's head in-world and sent to peers.
 * Both the name and the selection persist to localStorage.
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
  subheading.textContent = "Enter your name and pick an avatar — move it with WASD or the arrow keys";
  root.appendChild(subheading);

  const nameRow = document.createElement("div");
  nameRow.className = "name-row";
  const nameLabel = document.createElement("label");
  nameLabel.className = "name-label";
  nameLabel.htmlFor = "vw-name";
  nameLabel.textContent = "Your name";
  const nameInput = document.createElement("input");
  nameInput.id = "vw-name";
  nameInput.className = "name-input";
  nameInput.type = "text";
  nameInput.maxLength = MAX_NAME;
  nameInput.placeholder = "Shown above your head";
  nameInput.autocomplete = "off";
  nameInput.value = getSavedName() ?? "";
  nameRow.append(nameLabel, nameInput);
  root.appendChild(nameRow);

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

  /** Need both a name and an avatar before we can spawn. */
  function refreshStart(): void {
    startBtn.disabled = selectedId === null || nameInput.value.trim().length === 0;
  }

  function start(): void {
    const displayName = nameInput.value.trim();
    if (!selectedId || !displayName) return;
    localStorage.setItem(STORAGE_KEY, selectedId);
    localStorage.setItem(NAME_KEY, displayName);
    opts.onStart(selectedId, displayName);
  }

  startBtn.addEventListener("click", start);
  nameInput.addEventListener("input", refreshStart);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") start();
  });

  function select(id: string): void {
    selectedId = id;
    for (const [cid, card] of cards) card.classList.toggle("selected", cid === id);
    refreshStart();
  }

  for (const def of CHARACTERS) {
    const card = document.createElement("button");
    card.className = "char-card";
    if (def.id === selectedId) card.classList.add("selected");
    // Only the avatar is shown — you bring your own name. Keep the preset name
    // as the accessible label / tooltip so the cards are still identifiable.
    card.title = def.name;
    card.setAttribute("aria-label", def.name);

    const preview = drawCharacterPreview(def, 3);
    preview.className = "char-preview";
    card.appendChild(preview);

    card.addEventListener("click", () => select(def.id));
    cards.set(def.id, card);
    grid.appendChild(card);
  }

  const actions = document.createElement("div");
  actions.className = "char-actions";
  actions.appendChild(startBtn);
  root.appendChild(actions);

  refreshStart();
  if (!nameInput.value) nameInput.focus();
}

export function getSavedCharacterId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** The display name typed at character select — shown above the avatar. */
export function getSavedName(): string | null {
  return localStorage.getItem(NAME_KEY);
}
