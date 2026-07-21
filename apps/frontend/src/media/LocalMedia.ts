import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from "livekit-client";

/** Why capture failed — lets the caller decide whether to retry or stay
 *  position-only. `denied` = user blocked permission; `no-device` = no mic/cam. */
export type MediaFailure = "denied" | "no-device" | "failed";

/** Thrown by LocalMedia when getUserMedia fails, tagged with a friendly reason. */
export class MediaError extends Error {
  constructor(readonly reason: MediaFailure) {
    super(`media capture failed: ${reason}`);
    this.name = "MediaError";
  }
}

/** Map a getUserMedia/DOMException into our small failure taxonomy. */
function classify(e: unknown): MediaFailure {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "no-device";
  }
  return "failed";
}

/**
 * Owns the local microphone/camera tracks (issue #37). It only *captures* —
 * publishing to the room is RoomConnection's job. A denied permission or a
 * missing device throws a typed MediaError so callers can keep running in
 * position-only mode. Capture must be triggered by a user gesture (a click /
 * key), which also satisfies the browser's getUserMedia + autoplay policies.
 */
export class LocalMedia {
  private audio?: LocalAudioTrack;
  private video?: LocalVideoTrack;

  get micTrack(): LocalAudioTrack | undefined {
    return this.audio;
  }
  get camTrack(): LocalVideoTrack | undefined {
    return this.video;
  }
  get micOn(): boolean {
    return this.audio !== undefined;
  }
  get camOn(): boolean {
    return this.video !== undefined;
  }

  /** Capture the microphone (idempotent). Throws MediaError on denial/no-device. */
  async enableMic(): Promise<LocalAudioTrack> {
    if (this.audio) return this.audio;
    try {
      this.audio = await createLocalAudioTrack();
      return this.audio;
    } catch (e) {
      throw new MediaError(classify(e));
    }
  }

  disableMic(): void {
    this.audio?.stop();
    this.audio = undefined;
  }

  /** Capture the camera (idempotent). Throws MediaError on denial/no-device. */
  async enableCam(): Promise<LocalVideoTrack> {
    if (this.video) return this.video;
    try {
      this.video = await createLocalVideoTrack();
      return this.video;
    } catch (e) {
      throw new MediaError(classify(e));
    }
  }

  disableCam(): void {
    this.video?.stop();
    this.video = undefined;
  }

  /** Release both tracks (call when leaving the room). */
  stopAll(): void {
    this.disableMic();
    this.disableCam();
  }
}
