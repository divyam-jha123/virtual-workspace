/**
 * LiveKit data-message protocol shared by client and server.
 *
 * Every real-time game-state message that rides a LiveKit data channel is
 * defined here (shape + version + codec) so no app redefines wire formats.
 * Position is the first message type (Phase 0 de-risk of Option B: game state
 * travels over LiveKit, not a custom WebSocket gateway).
 */

import type { Facing } from "shared-types";

/** Bump when a message shape changes incompatibly. Receivers drop other versions. */
export const PROTOCOL_VERSION = 1 as const;

/** LiveKit data-channel topics. Lets receivers filter by message kind cheaply. */
export const DataTopic = {
  /** Avatar position updates (lossy). */
  POSITION: "pos",
} as const;

export type DataTopic = (typeof DataTopic)[keyof typeof DataTopic];

/**
 * Avatar position update sent on the lossy data channel.
 *
 * `t` is the sender's `Date.now()`; receivers use it to discard stale/reordered
 * messages (lossy delivery makes reordering possible).
 */
export interface PositionMessage {
  v: typeof PROTOCOL_VERSION;
  type: "pos";
  identity: string;
  x: number;
  y: number;
  facing?: Facing;
  t: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encode a position update to bytes for `publishData`. */
export function encodePosition(
  msg: Omit<PositionMessage, "v" | "type">,
): Uint8Array {
  const payload: PositionMessage = {
    v: PROTOCOL_VERSION,
    type: "pos",
    ...msg,
  };
  return encoder.encode(JSON.stringify(payload));
}

/**
 * Decode bytes from a `DataReceived` event into a `PositionMessage`.
 * Returns `null` for anything that isn't a valid, current-version position
 * message so callers can safely ignore foreign, malformed, or future traffic.
 */
export function decodePosition(bytes: Uint8Array): PositionMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const m = parsed as Record<string, unknown>;
  if (m.v !== PROTOCOL_VERSION || m.type !== "pos") return null;
  if (
    typeof m.identity !== "string" ||
    typeof m.x !== "number" ||
    typeof m.y !== "number" ||
    typeof m.t !== "number"
  ) {
    return null;
  }
  return parsed as PositionMessage;
}
