import { Users } from "lucide";
import { icon } from "../../game/ui/icon";

/** One row in the roster. `isLocal` marks "you"; `id` is the participant identity. */
export interface PresenceEntry {
  id: string;
  name: string;
  isLocal: boolean;
}

/** Green for "you", steel-blue for everyone else (matches the name-tag dot). */
const YOU_COLOR = "#5cc46a";
const PEER_COLOR = "#6f9be0";

/**
 * "Who's in this room" roster (issue #29). Plain DOM, mounted in the world
 * overlay. It's a dumb view: PixiWorld owns the authoritative presence set and
 * calls `render()` with the full list whenever someone joins or leaves.
 */
export class PresenceList {
  readonly root = document.createElement("div");
  private readonly listEl = document.createElement("ul");
  private readonly countEl = document.createElement("span");

  constructor() {
    this.root.className = "presence";

    const header = document.createElement("div");
    header.className = "presence-header";
    header.append(icon(Users, 14), "In this room");
    this.countEl.className = "presence-count";
    header.appendChild(this.countEl);

    this.listEl.className = "presence-list";
    this.root.append(header, this.listEl);
  }

  /** Rebuild the roster from the full list (you first, then the rest A→Z). */
  render(entries: PresenceEntry[]): void {
    const sorted = [...entries].sort((a, b) => {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    this.countEl.textContent = String(sorted.length);
    this.listEl.replaceChildren(
      ...sorted.map((e) => {
        const row = document.createElement("li");
        row.className = "presence-row";

        const dot = document.createElement("span");
        dot.className = "presence-dot";
        dot.style.background = e.isLocal ? YOU_COLOR : PEER_COLOR;

        const name = document.createElement("span");
        name.className = "presence-name";
        name.textContent = e.name;

        row.append(dot, name);
        if (e.isLocal) {
          const you = document.createElement("span");
          you.className = "presence-you";
          you.textContent = "you";
          row.appendChild(you);
        }
        return row;
      }),
    );
  }
}
