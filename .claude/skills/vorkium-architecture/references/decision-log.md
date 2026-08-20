# Vorkium decision log

Each record: **Context → Decision → Consequences → Revisit when**. Decisions are current unless
marked superseded. Append new ones at the end; never edit a record's meaning in place — supersede
it and say why.

---

## 1. LiveKit owns the realtime layer; the backend is a stateless REST service ("Option B")

**Context.** A spatial platform needs A/V plus a high-frequency position/presence channel. The
alternative ("Option A") was a custom WebSocket game server alongside an SFU: two realtime
systems, sticky sessions, Redis pub/sub, and scaling pain — for a two-person team.

**Decision.** LiveKit carries A/V, position, presence, chat, and screen-share. NestJS handles
auth, LiveKit token issuance, CRUD, and webhooks — request/response only.

**Consequences.** No sticky sessions; scaling = instance count; no Redis pub/sub; a hard
dependency on LiveKit and its pricing; anything realtime must be expressible as a LiveKit track,
data message, or participant event.

**Revisit when.** LiveKit cost or limits become the binding constraint at real pilot load, or a
feature genuinely cannot ride tracks/data messages.

---

## 2. No custom WebSocket gateway for game state

**Context.** The natural instinct on a NestJS backend is to add a `@WebSocketGateway` and relay
positions. That reintroduces exactly the statefulness Option B removed.

**Decision.** The backend exposes no socket for game state. `apps/backend/src/realtime/*` is
LiveKit orchestration (token minting, webhook handling, proximity/movement rules) — not fan-out.

**Consequences.** Any feature wanting server push must either ride LiveKit or be polled over
REST. Server-authoritative gameplay is out of scope by construction.

**Revisit when.** Anti-cheat or server-authoritative simulation becomes a product requirement.

---

## 3. Position rides lossy LiveKit data messages, interpolated on the client

**Context.** Position updates are high-frequency and worthless once stale; reliable delivery
would head-of-line-block and add latency.

**Decision.** Publish position as **lossy** data messages. Remote avatars are lerped/eased
client-side (`Player.ts` for local physics, `RemotePlayer.ts` for remote interpolation).

**Consequences.** Dropped packets are normal and must be tolerated by the interpolator; no
packet is ever the source of truth for anything durable. Chat, by contrast, uses the **reliable**
channel.

**Revisit when.** Interpolation artifacts become user-visible at target player counts.

---

## 4. Presence = LiveKit participant events live; webhooks persist the minimum

**Context.** The roster must be instant, but "who was in this room and when" also needs to
survive a refresh and be queryable.

**Decision.** The client drives the roster from `ParticipantConnected` / `ParticipantDisconnected`
in `RoomConnection`. LiveKit **webhooks** hit the backend, which persists minimal room membership
and last-seen. The presence roster UI lives in `apps/frontend/src/ui/presence`.

**Consequences.** Two presence views exist (live client view, persisted metadata) — they may
disagree briefly; the live view wins for UI. Webhook handling must be idempotent.

**Revisit when.** Presence history becomes a product feature rather than metadata.

---

## 5. Proximity A/V is client-driven subscribe/unsubscribe on a distance threshold

**Context.** Proximity audio is the differentiator. A server could compute who hears whom, but
the client already receives every position on the data channel.

**Decision.** One LiveKit room per space; the client attaches/detaches tracks as distance crosses
a threshold and handles distance-based volume, mute, and camera. The backend only mints scoped
tokens. Volume ramping comes after the on/off threshold works.

**Consequences.** Bandwidth is bounded by subscriptions, not room size; the trust boundary is the
client (fine pre-enterprise); private areas are a client-side subscription rule plus token scope.

**Revisit when.** Room sizes outgrow client-side subscription management, or eavesdropping via a
patched client becomes a real threat.

---

## 6. Postgres owns accounts and durable config only — never game state

**Context.** A DB in the repo invites writing positions to it.

**Decision.** Prisma + Postgres persist accounts (`User`), login codes (`LoginCode`), minimal
presence metadata, and later spaces/layout/objects. Position and live presence never touch it —
`prisma/schema.prisma` states this at the top of the file.

**Consequences.** No write amplification from movement; the DB stays small and easy to migrate
(Neon → DO Managed Postgres BLR at Phase 5).

**Revisit when.** Replay/analytics of movement becomes a requirement — and then it goes to an
append-only store, not the operational tables.

---

## 7. No Redis until Phase 3+, and never for movement or presence

**Context.** Redis is the reflex answer for realtime fan-out. Option B removes that need.

**Decision.** Redis is unused through Phase 2. From Phase 3 it may appear for rate-limiting,
caching, or queues only. `apps/backend/src/redis` exists as a seam, not a live dependency.

**Consequences.** One fewer service to run, deploy, and pay for during MVP.

**Revisit when.** Rate-limiting or cache pressure is measured, not anticipated.

---

## 8. Wire shapes live in `packages/protocol`, types in `packages/shared-types`

**Context.** Client and server both encode LiveKit data messages. Duplicated shapes drift and
break silently at runtime — there's no schema check on a data channel.

**Decision.** Every data-message shape and its version are defined once in `packages/protocol`
and imported by both apps. Cross-app types go in `packages/shared-types`. Neither app defines a
wire shape locally.

**Consequences.** Changing a message means bumping the protocol version and handling both
versions during rollout, since clients update independently.

**Revisit when.** Never, while both apps ship from this monorepo.

---

## 9. Auth is JWT; the LiveKit identity is the JWT `sub`

**Context.** LiveKit needs a stable identity per participant, and the token endpoint must not be
open.

**Decision.** Three sign-in paths — password, Google, and emailed one-time code — all resolve to
one `User` row keyed on email and issue a JWT. `JwtAuthGuard` protects `POST /realtime/token`,
which derives identity and display name from the authenticated user. `RoomConnection` uses the
JWT `sub` as the LiveKit identity; the session lives in localStorage and is sent as a Bearer
token.

**Consequences.** Display names and name tags come from the account, not from client input.
One-time codes are stored bcrypt-hashed with attempt caps and short expiry.

**Revisit when.** Phase 5 SSO (SAML/OIDC) lands — it must map into the same `User` row and the
same `sub`-as-identity rule.

---

## 10. Multi-tenancy via Postgres row-level security (Phase 4)

**Context.** Two companies must be fully isolated, without a DB or cluster per tenant at this
scale.

**Decision.** Tenant isolation is enforced by Postgres RLS policies. Tenant context is resolved
per request in `apps/backend/src/tenants/tenant-context`. No tenant abstractions are built before
Phase 4.

**Consequences.** Isolation is schema + policy work, no infra change; every tenant-scoped query
depends on the request-scoped tenant context being set — that seam is security-critical.

**Revisit when.** A contract demands physical isolation, or RLS becomes a performance problem.

---

## 11. Local-only through Phase 3; first cloud deploy at Phase 4 on DO App Platform (BLR1)

**Context.** Paying for and operating cloud infra before the product is validated is waste.

**Decision.** Phases 0–3 run on local Docker (Postgres, Redis, LiveKit) plus LiveKit Cloud's free
Build tier — ~$0. The first deploy is at Phase 4: stateless backend + static frontend on
DigitalOcean App Platform, region BLR1, push-to-deploy from GitHub, automatic TLS on
`workium.cc`, Postgres on Neon. Terraform (`infra/terraform/`) is introduced at Phase 4; staging
and prod are separate App Platform apps. DOKS only at Phase 6.

**Consequences.** CI (GitHub Actions) gates tests/lint from the start, but no deploy pipeline
exists until Phase 4. Secrets are `.env` locally, encrypted App Platform env vars from Phase 4.

**Revisit when.** A pilot needs a shared environment earlier than Phase 4.

---

## 12. LiveKit Cloud, not a self-hosted SFU

**Context.** Running an SFU is a full-time operational job.

**Decision.** Use LiveKit Cloud (Build tier in dev → Ship at real pilot use). Do not self-host.

**Consequences.** Media egresses to LiveKit's global edge, which collides with strict India media
residency — explicitly **parked** until Phase 5, when it becomes a conversation with LiveKit.
Worst case, self-host on BLR Droplets then. Note Build tier caps are hard cutoffs, not overages.

**Revisit when.** Phase 5 residency requirements land, or LiveKit Cloud cost exceeds the cost of
operating an SFU.

---

## 13. pnpm workspaces + Turborepo, with fixed app boundaries

**Context.** Backend, game client, marketing/dashboard site, and shared contracts must ship
together with one dependency graph.

**Decision.** One monorepo: `apps/backend`, `apps/frontend` (game client), `apps/web` (Next.js,
port 3200), `packages/{protocol,shared-types,config}`, `infra/`, `docs/`, `scripts/`.
Turbo drives `dev` / `build` / `test` / `lint`; per-app work uses `pnpm --filter <app> <script>`.

**Consequences.** `apps/web` and `apps/frontend` stay separate deployables and share only
`packages/*`. The frontend never imports backend internals — the contract between them is REST
plus `packages/protocol`.

**Revisit when.** An app needs an independent release cadence that the monorepo blocks.
