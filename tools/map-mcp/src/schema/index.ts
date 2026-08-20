/**
 * The map contract: layer stack, object classes, and property rules.
 *
 * Deliberately standalone — this module imports nothing from `apps/frontend` and
 * nothing from the MCP's own services. It is written to be lifted wholesale into
 * `packages/map-schema` when the Phaser work needs to share it; at that point the
 * files move and the imports change, and nothing else does.
 */

export const TILE_SIZE = 16;

/** Bottom -> top. Order is enforced by the validator. */
export const LAYER_ORDER = [
  "Ground",
  "Ground_Details",
  "Walls",
  "Furniture",
  "Decorations",
  "Collision",
  "Objects",
  "SpawnPoints",
  "InteractionZones",
  "AbovePlayer",
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

export type LayerKind = "tilelayer" | "objectgroup";

export const LAYER_KINDS: Record<LayerName, LayerKind> = {
  Ground: "tilelayer",
  Ground_Details: "tilelayer",
  Walls: "tilelayer",
  Furniture: "objectgroup",
  Decorations: "objectgroup",
  Collision: "tilelayer",
  Objects: "objectgroup",
  SpawnPoints: "objectgroup",
  InteractionZones: "objectgroup",
  AbovePlayer: "tilelayer",
};

/** A map is unusable without these; the rest are optional but must keep their order. */
export const REQUIRED_LAYERS: readonly LayerName[] = ["Ground", "Collision", "SpawnPoints"];

export function isLayerName(name: string): name is LayerName {
  return (LAYER_ORDER as readonly string[]).includes(name);
}

export type PropertyType = "string" | "int" | "float" | "bool";

export interface PropertySpec {
  type: PropertyType;
  required: boolean;
  /** Allowed values for a string property. */
  enum?: readonly string[];
  description: string;
}

export interface ObjectClassSpec {
  /**
   * Object layers this class may live on; the first is where `add_object` puts it.
   *
   * Several classes legitimately have two homes: a desk pod placed from the
   * catalog is a sprite on `Furniture` AND a `workstation` the game reads, so
   * pinning it to a single layer would make correct maps warn.
   */
  layers: readonly LayerName[];
  properties: Record<string, PropertySpec>;
  description: string;
}

export const OBJECT_CLASSES = {
  workstation: {
    layers: ["Objects", "Furniture"],
    description: "A desk cluster a player can occupy.",
    properties: {
      capacity: { type: "int", required: true, description: "How many people the workstation seats." },
      seats: { type: "string", required: false, description: "Comma-separated ids of the seat objects belonging to this workstation." },
    },
  },
  "meeting-room": {
    layers: ["Objects"],
    description: "A named room; pairs with an audio-private interaction zone.",
    properties: {
      name: { type: "string", required: true, description: "Display name of the room." },
      capacity: { type: "int", required: true, description: "How many people the room holds." },
      private: { type: "bool", required: true, description: "Whether audio is isolated to the room." },
    },
  },
  door: {
    layers: ["Objects", "Furniture"],
    description: "A transition between areas or maps.",
    properties: {
      target: { type: "string", required: false, description: "Map id or spawn id this door leads to." },
      locked: { type: "bool", required: true, description: "Whether the door blocks movement." },
    },
  },
  spawn: {
    layers: ["SpawnPoints"],
    description: "Where a player enters the map. Exactly one must be the default.",
    properties: {
      id: { type: "string", required: true, description: "Stable id referenced by doors and joins." },
      default: { type: "bool", required: true, description: "Exactly one spawn per map sets this true." },
    },
  },
  npc: {
    layers: ["Objects", "Furniture"],
    description: "A non-player character.",
    properties: {
      id: { type: "string", required: true, description: "Stable id for the NPC." },
      dialog: { type: "string", required: false, description: "Dialog key." },
    },
  },
  "interaction-zone": {
    layers: ["InteractionZones"],
    description: "A rectangle that fires an overlap callback in the runtime; how proximity A/V learns about private areas.",
    properties: {
      kind: {
        type: "string",
        required: true,
        enum: ["audio-private", "screen-share", "trigger"],
        description: "What entering the zone does.",
      },
      id: { type: "string", required: true, description: "Stable id for the zone." },
    },
  },
  seat: {
    layers: ["Objects", "Furniture"],
    description: "A single sittable position.",
    properties: {
      facing: { type: "string", required: true, enum: ["up", "down", "left", "right"], description: "Direction the seated avatar faces." },
      seatType: { type: "string", required: true, enum: ["chair", "sofa", "stool", "deskchair"], description: "Which sitting animation/art to use." },
    },
  },
} as const satisfies Record<string, ObjectClassSpec>;

export type ObjectClass = keyof typeof OBJECT_CLASSES;

export const OBJECT_CLASS_NAMES = Object.keys(OBJECT_CLASSES) as ObjectClass[];

export function isObjectClass(value: string): value is ObjectClass {
  return Object.prototype.hasOwnProperty.call(OBJECT_CLASSES, value);
}

export function getObjectClassSpec(value: string): ObjectClassSpec | undefined {
  return isObjectClass(value) ? (OBJECT_CLASSES[value] as ObjectClassSpec) : undefined;
}

/**
 * Ported from the Pixi client's `collision.ts`: a tile counts as blocked when a
 * footprint covers at least this fraction of it. Runtime collision is Arcade
 * Physics' job; here it is an authoring rule.
 */
export const COLLISION_COVERAGE = 0.5;

/** Guard rails so a bad loop cannot author an unusable map. */
export const LIMITS = {
  maxWidth: 512,
  maxHeight: 512,
  maxObjectsPerMap: 5000,
  maxLayers: 32,
} as const;

export interface MapConventions {
  tileSize: number;
  layerOrder: readonly string[];
  layerKinds: Record<string, LayerKind>;
  requiredLayers: readonly string[];
  objectClasses: Record<string, ObjectClassSpec>;
  collisionCoverage: number;
  limits: typeof LIMITS;
}

export function describeConventions(): MapConventions {
  return {
    tileSize: TILE_SIZE,
    layerOrder: LAYER_ORDER,
    layerKinds: LAYER_KINDS,
    requiredLayers: REQUIRED_LAYERS,
    objectClasses: OBJECT_CLASSES as unknown as Record<string, ObjectClassSpec>,
    collisionCoverage: COLLISION_COVERAGE,
    limits: LIMITS,
  };
}
