/**
 * Fetches a LiveKit join token from our backend — the game client's only
 * server call for real-time (Option B). After this, the browser talks straight
 * to LiveKit; the backend never sees movement. Mirrors the backend's
 * `POST /realtime/token` contract (see apps/backend RealtimeController).
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

export interface RoomToken {
  /** Signed LiveKit JWT (roomJoin + publish + subscribe + publishData). */
  token: string;
  /** LiveKit websocket URL to connect to. */
  url: string;
  roomName: string;
  identity: string;
}

/** Request a token for `identity` to join `roomName`. Throws on a non-2xx reply. */
export async function fetchToken(
  roomName: string,
  identity: string,
  name?: string,
): Promise<RoomToken> {
  const res = await fetch(`${BACKEND_URL}/realtime/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomName, identity, name }),
  });
  if (!res.ok) {
    throw new Error(`token request failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as RoomToken;
}
