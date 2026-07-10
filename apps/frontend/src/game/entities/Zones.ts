import { Container, Graphics } from "pixi.js";
import { TILE_SIZE } from "../map/tileset";
import { propCoverageTiles } from "../map/collision";
import type { OfficeMapData } from "../map/schema";
import type { PropType } from "../map/props";

/**
 * A rectangular tile region marking a sitting area ("private area" in
 * Gather.town terms). Zones are AUTO-GENERATED from the map's furniture (see
 * generateZones): every desk-pod / sofa / meeting cluster gets a zone covering
 * its chairs + tables + a 1-tile margin. Add special cases to ZONE_OVERRIDES.
 */
export interface ZoneDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Furniture that seeds a "sitting cluster" zone. */
const ZONE_SEED = new Set<PropType>([
  "pod2", "pod4", "pod6",
  "boardtable", "meetsmall", "trainpair",
  "sofa", "sofaV", "sofaCorner", "armchair", "beanbag",
  "coffeetable", "tv", "counter", "stool", "boardgame", "bookshelf",
]);
/** Seed tiles within this Chebyshev distance join the same cluster. */
const CLUSTER_GAP = 2;
/** Tiles added around a cluster's bounding box. Pods seed from their central
 *  desk only, so 2 reaches past the flanking chairs to leave a 1-tile margin. */
const ZONE_MARGIN = 2;

/** Manual zone additions per map, merged after the auto-generated ones. */
export const ZONE_OVERRIDES: Record<string, ZoneDef[]> = {};

/** Builds a zone around every furniture cluster (pods, lounges, meeting areas). */
export function generateZones(map: OfficeMapData): ZoneDef[] {
  const seeds: Array<{ x: number; y: number }> = [];
  for (const f of map.furniture) {
    if (!ZONE_SEED.has(f.prop)) continue;
    for (const [x, y] of propCoverageTiles(f.prop, f.tx, f.ty, 0.1)) seeds.push({ x, y });
  }

  // Connected components: two seed tiles cluster if within CLUSTER_GAP.
  const used = new Array(seeds.length).fill(false);
  const zones: ZoneDef[] = [];
  let n = 1;
  for (let i = 0; i < seeds.length; i++) {
    if (used[i]) continue;
    const stack = [i];
    used[i] = true;
    const group: Array<{ x: number; y: number }> = [];
    while (stack.length) {
      const j = stack.pop()!;
      group.push(seeds[j]);
      for (let k = 0; k < seeds.length; k++) {
        if (used[k]) continue;
        if (Math.abs(seeds[k].x - seeds[j].x) <= CLUSTER_GAP && Math.abs(seeds[k].y - seeds[j].y) <= CLUSTER_GAP) {
          used[k] = true;
          stack.push(k);
        }
      }
    }
    const xs = group.map((s) => s.x);
    const ys = group.map((s) => s.y);
    const x = Math.max(0, Math.min(...xs) - ZONE_MARGIN);
    const y = Math.max(0, Math.min(...ys) - ZONE_MARGIN);
    const x2 = Math.min(map.width - 1, Math.max(...xs) + ZONE_MARGIN);
    const y2 = Math.min(map.height - 1, Math.max(...ys) + ZONE_MARGIN);
    zones.push({ id: `${map.key}-zone-${n++}`, x, y, w: x2 - x + 1, h: y2 - y + 1 });
  }

  const merged = [...zones, ...(ZONE_OVERRIDES[map.key] ?? [])];
  // eslint-disable-next-line no-console
  console.log(`[zones] ${merged.length} zones generated on "${map.key}"`);
  return merged;
}

/** A player considered for zone membership. Kept generic (id + tile) so this
 *  supports many players later, not just the local one. */
export interface ZoneOccupant {
  id: string;
  tileX: number;
  tileY: number;
}

const OUTLINE_COLOR = 0x33ccff;
/** Flip to true to draw the zone outlines while testing. All zone LOGIC
 *  (membership, getOccupants, enter/leave events) runs regardless — this only
 *  controls the visual. */
const SHOW_ZONES = false;

/**
 * Draws each zone's boundary outline and tracks who is inside every frame.
 * Membership is a SET of occupant ids per zone (multi-player ready), and
 * enter/leave fire `onEnter` / `onLeave` (console.log by default) — this is
 * where a future "connect everyone in the same zone to a call" hook lives.
 */
export class ZoneManager {
  private zones: ZoneDef[];
  private occupants = new Map<string, Set<string>>();
  private gfx = new Map<string, Graphics>();
  private localZoneId: string | null = null;

  onEnter: (occupantId: string, zone: ZoneDef) => void;
  onLeave: (occupantId: string, zone: ZoneDef) => void;

  constructor(map: OfficeMapData) {
    this.zones = generateZones(map);
    for (const z of this.zones) this.occupants.set(z.id, new Set());
    this.onEnter = (id, z) =>
      // eslint-disable-next-line no-console
      console.log(`[zone] "${id}" entered ${z.id} — occupants: [${this.getOccupants(z.id).join(", ")}]`);
    this.onLeave = (id, z) =>
      // eslint-disable-next-line no-console
      console.log(`[zone] "${id}" left ${z.id} — occupants: [${this.getOccupants(z.id).join(", ")}]`);
  }

  get all(): ZoneDef[] {
    return this.zones;
  }

  /** Builds the outline graphics into `layer` (drawn above the floor, below
   *  characters). No-op when SHOW_ZONES is false — logic still runs. */
  render(layer: Container): void {
    if (!SHOW_ZONES) return;
    for (const z of this.zones) {
      const g = new Graphics();
      this.paint(g, z, false);
      layer.addChild(g);
      this.gfx.set(z.id, g);
    }
  }

  private paint(g: Graphics, z: ZoneDef, bright: boolean): void {
    g.clear();
    g.roundRect(z.x * TILE_SIZE, z.y * TILE_SIZE, z.w * TILE_SIZE, z.h * TILE_SIZE, 8)
      .fill({ color: OUTLINE_COLOR, alpha: bright ? 0.12 : 0.06 })
      .stroke({ width: 2, color: OUTLINE_COLOR, alpha: bright ? 0.9 : 0.5 });
  }

  /**
   * Recompute membership from all occupants, firing enter/leave, and brighten
   * the outline of the zone the local player is in.
   */
  update(occupants: ZoneOccupant[], localId: string): void {
    for (const z of this.zones) {
      const prev = this.occupants.get(z.id)!;
      const now = new Set<string>();
      for (const o of occupants) if (this.inside(z, o.tileX, o.tileY)) now.add(o.id);
      this.occupants.set(z.id, now);
      for (const id of now) if (!prev.has(id)) this.onEnter(id, z);
      for (const id of prev) if (!now.has(id)) this.onLeave(id, z);
    }

    // Brighten the local player's zone outline (only if outlines are drawn).
    const localZone = this.zones.find((z) => this.occupants.get(z.id)!.has(localId)) ?? null;
    if ((localZone?.id ?? null) !== this.localZoneId) {
      const prevGfx = this.localZoneId ? this.gfx.get(this.localZoneId) : undefined;
      if (prevGfx) this.paint(prevGfx, this.zones.find((z) => z.id === this.localZoneId)!, false);
      const nextGfx = localZone ? this.gfx.get(localZone.id) : undefined;
      if (nextGfx && localZone) this.paint(nextGfx, localZone, true);
      this.localZoneId = localZone?.id ?? null;
    }
  }

  private inside(z: ZoneDef, tx: number, ty: number): boolean {
    return tx >= z.x && tx < z.x + z.w && ty >= z.y && ty < z.y + z.h;
  }

  /** Occupant ids currently inside a zone (drives the future group-call feature). */
  getOccupants(zoneId: string): string[] {
    return [...(this.occupants.get(zoneId) ?? [])];
  }
}
