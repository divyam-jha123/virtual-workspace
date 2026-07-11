const HORIZONTAL: Record<string, number> = {
  KeyA: -1,
  ArrowLeft: -1,
  KeyD: 1,
  ArrowRight: 1,
};
const VERTICAL: Record<string, number> = {
  KeyW: -1,
  ArrowUp: -1,
  KeyS: 1,
  ArrowDown: 1,
};
const INV_SQRT2 = 0.70710678;

export interface InputVector {
  x: number;
  y: number;
}

/**
 * Keyboard movement input as a 2D vector. Held keys live in a Set; a parallel
 * press-order list resolves conflicts so that on opposite keys (e.g. left +
 * right) the MOST RECENTLY pressed wins instead of cancelling to a freeze.
 * Perpendicular keys combine into a diagonal, which is normalized so diagonal
 * movement isn't faster than cardinal.
 */
export class Input {
  private held = new Set<string>();
  private order: string[] = []; // press order of currently-held movement keys

  private onKeyDown = (e: KeyboardEvent) => {
    if (!(e.code in HORIZONTAL) && !(e.code in VERTICAL)) return;
    if (e.code.startsWith("Arrow")) e.preventDefault(); // don't scroll the page
    if (this.held.has(e.code)) return; // ignore auto-repeat
    this.held.add(e.code);
    this.order.push(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.held.delete(e.code)) return;
    this.order = this.order.filter((c) => c !== e.code);
  };

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.held.clear();
    this.order = [];
  }

  /** Normalized movement vector; components in [-1, 1], magnitude ≤ 1. */
  vector(): InputVector {
    let x = this.lastSign(HORIZONTAL);
    let y = this.lastSign(VERTICAL);
    if (x !== 0 && y !== 0) {
      x *= INV_SQRT2;
      y *= INV_SQRT2;
    }
    return { x, y };
  }

  /** Sign of the most-recently-pressed still-held key on one axis. */
  private lastSign(map: Record<string, number>): number {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const code = this.order[i];
      if (code in map) return map[code];
    }
    return 0;
  }
}
