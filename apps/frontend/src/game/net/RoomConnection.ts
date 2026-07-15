import { Room, RoomEvent, type RemoteParticipant } from "livekit-client";
import { DataTopic, decodePosition, encodePosition, type PositionMessage } from "protocol";
import type { Facing } from "shared-types";
import { fetchToken } from "./tokenClient";

/** Publish at most this often while moving (ms) → ~10 Hz, matching the spike. */
const PUBLISH_INTERVAL_MS = 100;
/** When idle (position unchanged), still resend this often so a peer that joins
 *  after we stopped moving still learns where we're standing (ms). */
const IDLE_HEARTBEAT_MS = 1000;

/** Events the world reacts to. Kept tiny so PixiWorld owns the avatars.
 *  `displayName` is the peer's name (the LiveKit participant name), shown on
 *  their name tag. */
export interface RoomCallbacks {
  onRemoteMove: (msg: PositionMessage, displayName?: string) => void;
  onRemoteLeave: (identity: string) => void;
}

/** A stable per-tab identity, so a refresh rejoins as the "same" participant. */
function getIdentity(): string {
  const KEY = "vw-identity";
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = `user-${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Wraps a LiveKit room for position sync (issue #11): fetch a token, join,
 * publish the local avatar's position on the lossy data channel, and surface
 * remote participants' position messages + departures. No backend WebSocket —
 * everything after the token rides LiveKit directly.
 */
export class RoomConnection {
  private room = new Room();
  private readonly identity = getIdentity();
  private connected = false;
  private lastSent = 0;
  private last = { x: NaN, y: NaN, facing: "down" as Facing };

  constructor(
    private readonly roomName: string,
    /** Local player's display name — sent as the LiveKit participant name so
     *  peers can show it on our name tag. (Once login lands, the backend
     *  overrides this with the authenticated user's name.) */
    private readonly displayName: string,
    private readonly cb: RoomCallbacks,
  ) {}

  /** Leave the room when the tab is closed/hidden so our avatar disappears for
   *  peers immediately, instead of lingering until LiveKit's join timeout. */
  private readonly onPageHide = () => this.disconnect();

  get localIdentity(): string {
    return this.identity;
  }

  /** Fetch a token, wire events, and join. Throws if the backend/LiveKit is
   *  unreachable — the caller treats that as "run offline / single-player". */
  async connect(): Promise<void> {
    const { token, url } = await fetchToken(this.roomName, this.identity, this.displayName);

    this.room
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant, _kind, topic) => {
        if (topic !== undefined && topic !== DataTopic.POSITION) return;
        const msg = decodePosition(payload);
        // The peer's display name rides on their participant name.
        if (msg && msg.identity !== this.identity) this.cb.onRemoteMove(msg, participant?.name);
      })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) =>
        this.cb.onRemoteLeave(p.identity),
      );

    await this.room.connect(url, token);
    this.connected = true;
    window.addEventListener("pagehide", this.onPageHide);
  }

  /**
   * Publish the local position — throttled to ~10 Hz, deduped when unchanged
   * (with a 1 Hz idle heartbeat). Safe to call every frame; no-ops until
   * connected. Lossy delivery: a dropped packet is just corrected by the next.
   */
  publishPosition(x: number, y: number, facing: Facing, nowMs: number): void {
    if (!this.connected) return;
    if (nowMs - this.lastSent < PUBLISH_INTERVAL_MS) return;
    const changed = x !== this.last.x || y !== this.last.y || facing !== this.last.facing;
    if (!changed && nowMs - this.lastSent < IDLE_HEARTBEAT_MS) return;

    this.lastSent = nowMs;
    this.last = { x, y, facing };
    const bytes = encodePosition({ identity: this.identity, x, y, facing, t: Date.now() });
    // Copy into a plain ArrayBuffer-backed view (publishData wants Uint8Array<ArrayBuffer>).
    void this.room.localParticipant.publishData(new Uint8Array(bytes), {
      reliable: false,
      topic: DataTopic.POSITION,
    });
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    window.removeEventListener("pagehide", this.onPageHide);
    void this.room.disconnect();
  }
}
