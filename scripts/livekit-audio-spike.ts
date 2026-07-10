/**
 * Phase 0 de-risk spike (issue #3): prove one *audio track* flows over LiveKit
 * between two clients — the media path Phase 2 (Proximity A/V) depends on. The
 * data-channel counterpart is `livekit-position-spike.ts`.
 *
 * Flow:
 *   1. Ask the backend to mint two LiveKit tokens (clientA, clientB) for the
 *      same room — exercising the backend's only real-time role.
 *   2. Both join the room via @livekit/rtc-node (headless participants).
 *   3. clientA publishes a synthetic 440Hz sine tone as an audio track.
 *   4. clientB subscribes to that track and counts the AudioFrames it receives.
 *   5. Assert clientB received >= 1 audio frame, then exit 0 (or 1 on failure).
 *
 * Run:  pnpm --filter backend dev   (in another shell)
 *       pnpm spike:audio
 */
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from '@livekit/rtc-node';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the local .env first, then the repo-root .env (scripts/ is one level
// down) so `pnpm spike:audio` works regardless of cwd. Mirrors the backend's
// ['.env', '../../.env'] search order — first value found wins per key.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: [resolve(here, '.env'), resolve(here, '..', '.env')] });

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const ROOM = process.env.SPIKE_ROOM ?? 'spike-room';

const SAMPLE_RATE = 48000;
const NUM_CHANNELS = 1;
const TONE_HZ = 440;
const FRAME_MS = 10; // 10ms frames → 100 frames/sec
const PUBLISH_MS = 2000; // ~2s of tone
const SETTLE_MS = 1500; // grace for in-flight audio frames

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

async function mintToken(identity: string): Promise<{ token: string; url: string }> {
  const res = await fetch(`${BACKEND_URL}/realtime/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomName: ROOM, identity, name: identity }),
  });
  if (!res.ok) {
    fail(`Token request for "${identity}" failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { token: string; url: string };
}

async function main(): Promise<void> {
  if (!LIVEKIT_URL) {
    fail('LIVEKIT_URL is not set. Copy .env.example to .env and fill it in.');
  }

  console.log(`→ Requesting tokens from ${BACKEND_URL} for room "${ROOM}"...`);
  const [a, b] = await Promise.all([mintToken('clientA'), mintToken('clientB')]);
  // Backend echoes the LiveKit URL; prefer it, fall back to env.
  const url = a.url || LIVEKIT_URL!;

  const roomA = new Room();
  const roomB = new Room();

  let framesReceived = 0;
  let lastLogged = 0;
  // clientB: when clientA's audio track is subscribed, drain its AudioStream
  // and count frames. autoSubscribe (below) triggers this automatically.
  roomB.on(
    RoomEvent.TrackSubscribed,
    (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      console.log(`→ clientB subscribed to audio track from ${participant.identity}.`);
      const reader = new AudioStream(track).getReader();
      void (async () => {
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
          framesReceived += 1;
          if (framesReceived - lastLogged >= 20 || framesReceived === 1) {
            lastLogged = framesReceived;
            console.log(`   clientB ← audio frame #${framesReceived} from ${participant.identity}`);
          }
        }
      })();
    },
  );

  console.log(`→ Connecting both clients to ${url}...`);
  await Promise.all([
    roomA.connect(url, a.token, { autoSubscribe: true, dynacast: false }),
    roomB.connect(url, b.token, { autoSubscribe: true, dynacast: false }),
  ]);
  console.log('→ Connected. clientA publishing a 440Hz audio track...');

  // Wait until clientB actually sees clientA before publishing, so the track is
  // subscribed rather than missed.
  await waitForPeer(roomB, 'clientA');

  const publisher = roomA.localParticipant;
  if (!publisher) fail('clientA has no local participant after connecting.');

  const source = new AudioSource(SAMPLE_RATE, NUM_CHANNELS);
  const track = LocalAudioTrack.createAudioTrack('spike-tone', source);
  await publisher.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );

  const samplesPerChannel = (SAMPLE_RATE * FRAME_MS) / 1000; // 480 samples/frame
  const frameCount = PUBLISH_MS / FRAME_MS;
  let phase = 0;
  const phaseStep = (2 * Math.PI * TONE_HZ) / SAMPLE_RATE;
  for (let i = 0; i < frameCount; i++) {
    const data = new Int16Array(samplesPerChannel);
    for (let s = 0; s < samplesPerChannel; s++) {
      data[s] = Math.round(Math.sin(phase) * 0.3 * 32767);
      phase += phaseStep;
    }
    // captureFrame resolves as the frame is played out, pacing the loop for us.
    await source.captureFrame(new AudioFrame(data, SAMPLE_RATE, NUM_CHANNELS, samplesPerChannel));
  }

  await sleep(SETTLE_MS);

  await Promise.all([roomA.disconnect(), roomB.disconnect()]);

  console.log(`\n→ clientB received ${framesReceived} audio frames.`);
  if (framesReceived === 0) {
    fail('clientB received ZERO audio frames — audio track transport NOT proven.');
  }
  console.log(`✅ Audio track proven over LiveKit between two clients (${framesReceived} frames).`);
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve once `identity` is a remote participant in `room` (or after timeout). */
function waitForPeer(room: Room, identity: string, timeoutMs = 5000): Promise<void> {
  const alreadyHere = [...room.remoteParticipants.values()].some(
    (p) => p.identity === identity,
  );
  if (alreadyHere) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
      resolve();
    }, timeoutMs);
    const onJoin = (p: { identity: string }): void => {
      if (p.identity === identity) {
        clearTimeout(timer);
        room.off(RoomEvent.ParticipantConnected, onJoin);
        resolve();
      }
    };
    room.on(RoomEvent.ParticipantConnected, onJoin);
  });
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
