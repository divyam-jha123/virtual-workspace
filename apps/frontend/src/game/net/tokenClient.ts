/**
 * Fetches a LiveKit join token from our backend — the game client's only
 * server call for real-time (Option B). After this, the browser talks straight
 * to LiveKit; the backend never sees movement. Mirrors the backend's
 * `POST /realtime/token` contract (see apps/backend RealtimeController).
 *
 * The endpoint is authenticated: identity and display name are derived from the
 * JWT, never from this request, so a client cannot join as someone else.
 */

import { getSession } from "../../state/session";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

export interface RoomToken {
  /** Signed LiveKit JWT (roomJoin + publish + subscribe + publishData). */
  token: string;
  /** LiveKit websocket URL to connect to. */
  url: string;
  roomName: string;
  /** The authenticated user's id — our LiveKit participant identity. */
  identity: string;
}

/** Thrown when the backend rejects our session; the caller should sign out. */
export class UnauthorizedError extends Error {
  constructor() {
    super("session expired or invalid");
    this.name = "UnauthorizedError";
  }
}

/** Request a token to join `roomName` as the signed-in user. Throws on non-2xx. */
export async function fetchToken(roomName: string): Promise<RoomToken> {
  const session = getSession();
  if (!session) {
    throw new UnauthorizedError();
  }

  const res = await fetch(`${BACKEND_URL}/realtime/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
    },
    // Only the room: the backend fills identity + name in from the JWT, and
    // rejects any extra field (ValidationPipe runs with forbidNonWhitelisted).
    body: JSON.stringify({ roomName }),
  });

  if (res.status === 401) {
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    throw new Error(`token request failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as RoomToken;
}
