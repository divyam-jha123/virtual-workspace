# LiveKit audio spike (Phase 0 de-risk — issue #3)

Proves the **media path** Phase 2 (Proximity A/V) depends on: **one audio track flows over
LiveKit between two clients**, with the backend doing nothing but minting tokens. Sibling of
the [position spike](./livekit-position-spike.md), which covers the lossy *data* channel.

## What it exercises

- `POST /realtime/token` — the backend's only real-time role (LiveKit token issuance). The
  minted token already grants `canPublish` + `canSubscribe`, so no backend change is needed.
- Two headless `@livekit/rtc-node` participants: `clientA` publishes a synthetic 440Hz sine
  tone as an audio track; `clientB` subscribes to it and counts the audio frames it receives.

## Prerequisites

1. A free **LiveKit Cloud** project (https://cloud.livekit.io). Copy its URL + an API
   key/secret from *Project Settings → Keys*.
2. `cp .env.example .env` and fill in `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

## Run

```bash
pnpm install
pnpm build                     # builds shared-types + protocol (+ everything else)

pnpm --filter backend dev      # shell 1: backend on :3000
pnpm spike:audio               # shell 2: run the two-client audio spike
```

## Expected output

```
→ Requesting tokens from http://localhost:3000 for room "spike-room"...
→ Connecting both clients to wss://<project>.livekit.cloud...
→ Connected. clientA publishing a 440Hz audio track...
→ clientB subscribed to audio track from clientA.
   clientB ← audio frame #1 from clientA
   clientB ← audio frame #20 from clientA
   ...
→ clientB received 200 audio frames.
✅ Audio track proven over LiveKit between two clients (200 frames).
```

`clientB` receiving ≥ 1 audio frame → exit `0`. Zero received → exit `1` (so the failure
mode is detectable, e.g. bad creds or a blocked WebRTC media path).

## Notes

- The tone is generated in-code (no audio asset). Audio rides LiveKit's media path (WebRTC
  tracks), not the data channel — this is the transport that later carries real mic audio.
- Not wired into CI: it needs live LiveKit creds (secrets) and outbound WebRTC, matching
  Phase 0's local-dev-only posture.
