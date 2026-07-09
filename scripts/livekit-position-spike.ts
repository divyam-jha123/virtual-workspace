/**
 * Phase 0 de-risk spike (issue #9): prove avatar position travels over a
 * LiveKit *lossy* data channel between two clients — no custom WebSocket
 * gateway, which is Option B's core bet.
 *
 * Flow:
 *   1. Ask the backend to mint two LiveKit tokens (clientA, clientB) for the
 *      same room — exercising the backend's only real-time role.
 *   2. Both join the room via @livekit/rtc-node (headless participants).
 *   3. clientA publishes a moving {x,y} position on the lossy channel @10Hz.
 *   4. clientB decodes each DataReceived payload with the shared `protocol`
 *      codec and logs it.
 *   5. Assert clientB received >= 1 position, then exit 0 (or 1 on failure).
 *
 * Run:  pnpm --filter backend dev   (in another shell)
 *       pnpm spike:position
 */
import { Room, RoomEvent } from '@livekit/rtc-node';
import { config as loadEnv } from 'dotenv';
import { DataTopic, decodePosition, encodePosition } from 'protocol';

loadEnv();

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const ROOM = process.env.SPIKE_ROOM ?? 'spike-room';

const PUBLISH_HZ = 10;
const PUBLISH_COUNT = 20; // ~2s of updates
const SETTLE_MS = 1500; // grace for in-flight lossy packets

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

  let received = 0;
  let lastLogged = 0;
  roomB.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant, _kind, topic) => {
    if (topic !== undefined && topic !== DataTopic.POSITION) return;
    const msg = decodePosition(payload);
    if (!msg) return;
    received += 1;
    // Log a sample so the moving coordinates are visible without flooding.
    if (received - lastLogged >= 5 || received === 1) {
      lastLogged = received;
      console.log(
        `   clientB ← position from ${msg.identity}: (${msg.x.toFixed(1)}, ${msg.y.toFixed(1)}) t=${msg.t}`,
      );
    }
  });

  console.log(`→ Connecting both clients to ${url}...`);
  await Promise.all([
    roomA.connect(url, a.token, { autoSubscribe: true, dynacast: false }),
    roomB.connect(url, b.token, { autoSubscribe: true, dynacast: false }),
  ]);
  console.log('→ Connected. clientA publishing positions on the lossy channel...');

  // Wait until clientB actually sees clientA, so early packets aren't dropped
  // simply because the peer wasn't known yet.
  await waitForPeer(roomB, 'clientA');

  const publisher = roomA.localParticipant;
  if (!publisher) fail('clientA has no local participant after connecting.');

  let x = 0;
  for (let i = 0; i < PUBLISH_COUNT; i++) {
    x += 5;
    const y = 100 + Math.round(Math.sin(i / 3) * 50);
    const bytes = encodePosition({ identity: 'clientA', x, y, t: Date.now() });
    await publisher.publishData(bytes, {
      reliable: false,
      topic: DataTopic.POSITION,
    });
    await sleep(1000 / PUBLISH_HZ);
  }

  await sleep(SETTLE_MS);

  await Promise.all([roomA.disconnect(), roomB.disconnect()]);

  console.log(`\n→ clientB received ${received}/${PUBLISH_COUNT} position messages.`);
  if (received === 0) {
    fail('clientB received ZERO positions — data channel transport NOT proven.');
  }
  console.log(`✅ Avatar position proven over LiveKit lossy data channel (${received} received).`);
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
