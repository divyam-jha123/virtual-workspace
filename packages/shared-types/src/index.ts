/**
 * Types shared across apps (backend, frontend, spike scripts).
 *
 * Keep this package free of runtime dependencies — it is pure types plus the
 * small value declarations that describe them.
 */

/** A 2D world-space position of an avatar, in map units. */
export interface Position {
  x: number;
  y: number;
}

/** The direction an avatar is facing. */
export type Facing = "up" | "down" | "left" | "right";

/**
 * The latest known state of a single avatar. `identity` matches the LiveKit
 * participant identity; `t` is the sender's `Date.now()` timestamp, used by the
 * client to drop stale/out-of-order lossy messages.
 */
export interface AvatarState {
  identity: string;
  position: Position;
  facing?: Facing;
  t: number;
}
