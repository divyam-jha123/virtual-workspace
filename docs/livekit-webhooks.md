# LiveKit presence webhooks (Phase 1 — issue #26)

Persists **minimal presence metadata** (room membership + last-seen) by consuming
LiveKit webhooks. This is metadata only — under Option B the backend never relays
position or any other game state; those ride LiveKit directly.

## What it does

- `POST /realtime/webhooks/livekit` — receives LiveKit webhooks, verifies the
  signed `Authorization` header against the raw body, and applies presence events.
- Handles `participant_joined`, `participant_left`, and `room_finished`; all other
  events are acknowledged and ignored.
- Writes one `RoomMembership` row per `(roomName, identity)`. `leftAt == null`
  means the participant is currently connected; `room_finished` closes out anyone
  still marked present.

The endpoint is intentionally **unauthenticated at the HTTP layer** — LiveKit
authenticates itself with a JWT (the `Authorization` header) whose `sha256` claim
must match a hash of the raw request body, verified with the same
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` used to mint join tokens.

## Configure LiveKit Cloud

In your LiveKit project: **Settings → Webhooks → Add endpoint** and point it at your
backend's public URL:

```
https://<your-backend>/realtime/webhooks/livekit
```

For local development, expose `localhost:3000` with a tunnel (e.g. `ngrok http 3000`)
and use the tunnel URL. No extra env vars are needed — verification reuses
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` from `.env`.

## Notes

- The webhook body arrives as `application/webhook+json`; `main.ts` enables
  `rawBody` and teaches the JSON body parser to accept that content type so the
  exact posted bytes survive for signature verification.
- Handlers upsert, so duplicate deliveries and reconnects are idempotent.
