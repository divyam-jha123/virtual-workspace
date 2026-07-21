import { Room, RoomEvent, type RemoteParticipant, type RemoteTrackPublication } from "livekit-client";
import { DataTopic, decodePosition, encodePosition, type PositionMessage } from "protocol";
import type { Facing } from "shared-types";
import { getSession } from "../../state/session";
import { LocalMedia, MediaError, type MediaFailure } from "../../media/LocalMedia";
import { fetchToken } from "./tokenClient";

/** Result of a mic/cam toggle: the resulting state, plus why it failed (if it
 *  did) so the caller can stay in position-only mode. */
export interface MediaToggleResult {
  on: boolean;
  failure?: MediaFailure;
}

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

/**
 * Wraps a LiveKit room for position sync (issue #11): fetch a token, join,
 * publish the local avatar's position on the lossy data channel, and surface
 * remote participants' position messages + departures. No backend WebSocket —
 * everything after the token rides LiveKit directly.
 */
export class RoomConnection {
  private room = new Room();
  /**
   * The signed-in user's id. This has to match the LiveKit participant identity
   * the backend puts in our token (it uses the JWT's `sub`), because we stamp it
   * on every position we publish and use it to filter our own messages back out.
   * If the two ever diverge, you see a ghost of yourself and peers never leave.
   */
  private readonly identity: string;
  private connected = false;
  private lastSent = 0;
  private last = { x: NaN, y: NaN, facing: "down" as Facing };
  /** Local mic/camera capture (issue #37). Published to `this.room` on toggle. */
  private readonly media = new LocalMedia();

  constructor(
    private readonly roomName: string,
    private readonly cb: RoomCallbacks,
  ) {
    const session = getSession();
    if (!session) {
      throw new Error("cannot join a room while signed out");
    }
    this.identity = session.userId;
  }

  /** Leave the room when the tab is closed/hidden so our avatar disappears for
   *  peers immediately, instead of lingering until LiveKit's join timeout. */
  private readonly onPageHide = () => this.disconnect();

  get localIdentity(): string {
    return this.identity;
  }

  /** Fetch a token, wire events, and join. Throws if the backend/LiveKit is
   *  unreachable — the caller treats that as "run offline / single-player". */
  async connect(): Promise<void> {
    const { token, url } = await fetchToken(this.roomName);

    this.room
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant, _kind, topic) => {
        if (topic !== undefined && topic !== DataTopic.POSITION) return;
        const msg = decodePosition(payload);
        // The peer's display name rides on their participant name.
        if (msg && msg.identity !== this.identity) this.cb.onRemoteMove(msg, participant?.name);
      })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) =>
        this.cb.onRemoteLeave(p.identity),
      )
      // A/V publications from peers (issue #37 acceptance: confirm tracks land on
      // the remote participant). Subscription/rendering is a later issue (#38).
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
        // eslint-disable-next-line no-console
        console.log(`[media] ${p.identity} published ${pub.kind} track (${pub.trackSid})`);
      })
      .on(RoomEvent.TrackUnpublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
        // eslint-disable-next-line no-console
        console.log(`[media] ${p.identity} unpublished ${pub.kind} track`);
      });

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

  get micOn(): boolean {
    return this.media.micOn;
  }
  get camOn(): boolean {
    return this.media.camOn;
  }

  /**
   * Turn the microphone on/off (issue #37). On enable it captures the mic and
   * publishes it to the room; on disable it unpublishes + stops the track. On a
   * permission denial or missing device it stays off and returns the reason, so
   * the caller can keep running position-only. No-ops until connected.
   */
  async setMicEnabled(on: boolean): Promise<MediaToggleResult> {
    if (!this.connected) return { on: false };
    try {
      if (on) {
        await this.unlockAudio();
        const track = await this.media.enableMic();
        await this.room.localParticipant.publishTrack(track);
      } else {
        const track = this.media.micTrack;
        if (track) await this.room.localParticipant.unpublishTrack(track, true);
        this.media.disableMic();
      }
      return { on: this.media.micOn };
    } catch (e) {
      this.media.disableMic();
      const failure = e instanceof MediaError ? e.reason : "failed";
      // eslint-disable-next-line no-console
      console.warn(`[media] mic ${on ? "enable" : "disable"} failed: ${failure}`);
      return { on: false, failure };
    }
  }

  /** Turn the camera on/off — same contract as setMicEnabled. */
  async setCamEnabled(on: boolean): Promise<MediaToggleResult> {
    if (!this.connected) return { on: false };
    try {
      if (on) {
        const track = await this.media.enableCam();
        await this.room.localParticipant.publishTrack(track);
      } else {
        const track = this.media.camTrack;
        if (track) await this.room.localParticipant.unpublishTrack(track, true);
        this.media.disableCam();
      }
      return { on: this.media.camOn };
    } catch (e) {
      this.media.disableCam();
      const failure = e instanceof MediaError ? e.reason : "failed";
      // eslint-disable-next-line no-console
      console.warn(`[media] cam ${on ? "enable" : "disable"} failed: ${failure}`);
      return { on: false, failure };
    }
  }

  /** Satisfy the browser autoplay policy: unlock audio playback on the first
   *  user gesture (the toggle) so future subscribed audio (#38) can play. */
  private async unlockAudio(): Promise<void> {
    if (this.room.canPlaybackAudio) return;
    try {
      await this.room.startAudio();
    } catch {
      // No user gesture yet — harmless; the next toggle retries.
    }
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    window.removeEventListener("pagehide", this.onPageHide);
    this.media.stopAll();
    void this.room.disconnect();
  }
}
