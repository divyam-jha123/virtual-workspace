# LiveKit position spike (Phase 0 de-risk — issue #9)

Proves Option B's core bet: **avatar position travels over a LiveKit lossy data
channel between two clients**, with the backend doing nothing but minting tokens.
No custom WebSocket gateway, no Redis, no server-side game state.

## What it exercises

- `POST /realtime/token` — the backend's only real-time role (LiveKit token issuance).
- `packages/protocol` — the shared `PositionMessage` wire format + `encode/decodePosition`.
- Two headless `@livekit/rtc-node` participants: `clientA` publishes positions on the
  lossy channel, `clientB` receives and decodes them.

## Prerequisites

1. A free **LiveKit Cloud** project (https://cloud.livekit.io). Copy its URL + an API
   key/secret from *Project Settings → Keys*.
2. `cp .env.example .env` and fill in `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

## Run

```bash
pnpm install
pnpm build                     # builds shared-types + protocol (+ everything else)

pnpm --filter backend dev      # shell 1: backend on :3000
pnpm spike:position            # shell 2: run the two-client spike
```

## Expected output

```
→ Requesting tokens from http://localhost:3000 for room "spike-room"...
→ Connecting both clients to wss://<project>.livekit.cloud...
→ Connected. clientA publishing positions on the lossy channel...
   clientB ← position from clientA: (5.0, 100.0) t=...
   clientB ← position from clientA: (30.0, 138.0) t=...
   ...
→ clientB received 20/20 position messages.
✅ Avatar position proven over LiveKit lossy data channel (20 received).
```

`clientB` receiving ≥ 1 position → exit `0`. Zero received → exit `1` (so the failure
mode is detectable, e.g. bad creds or a blocked WebRTC path).

## Notes

- Lossy delivery means occasional drops are expected under load — the spike asserts
  "at least one", not "all", which is the correct semantic for position updates.
- Not wired into CI: it needs live LiveKit creds (secrets) and outbound WebRTC, matching
  Phase 0's local-dev-only posture.
