---
name: vorkium-architecture
description: Vorkium's architectural decisions — the Option B (LiveKit-carries-realtime) design, stateless REST backend, monorepo boundaries, data ownership, multi-tenancy and deployment topology. Use when designing, planning, reviewing, or questioning anything structural in this repo: adding a service/module/package, choosing where state lives, wiring realtime (position, presence, chat, screen-share, A/V), touching auth or the DB schema, adding Redis/WebSockets/queues, changing deploy targets, or answering "why is it built this way?".
---

# Vorkium architecture

Vorkium is a Gather-style spatial collaboration platform for Indian enterprises: avatars move
on a 2D map, and audio/video connects by proximity. This skill is the standing record of *how*
it is built and *why*, so new work fits the existing shape instead of re-litigating it.

Read this before proposing structure. If a change conflicts with a decision below, say so
explicitly and propose amending the decision — don't route around it silently.

## The one decision everything else hangs off: Option B

**LiveKit carries the entire realtime layer. The backend is a stateless REST service.**

| Concern | Owner |
| :-- | :-- |
| Audio / video | LiveKit tracks |
| Avatar position | LiveKit data messages (lossy, client-interpolated) |
| Presence (join/leave/roster) | LiveKit participant events (+ webhooks for persistence) |
| Text chat | LiveKit data messages (reliable) |
| Screen share | LiveKit track publish |
| Auth, token issuance, CRUD, webhooks | NestJS REST API |
| Accounts, spaces, layout, presence metadata | Postgres via Prisma |

Consequences that are non-negotiable while Option B holds:

- **No custom WebSocket gateway for game state.** `apps/backend/src/realtime/*` is LiveKit
  orchestration and token logic, not a fan-out hub.
- **The backend never broadcasts position** and never holds per-room in-memory state.
- **No sticky sessions, no Redis pub/sub.** Horizontal scaling = more instances.
- **Proximity A/V is client-driven**: the client already has everyone's positions from the data
  channel, so it subscribes/unsubscribes tracks on a distance threshold and ramps volume. The
  backend's only role in A/V is minting scoped tokens.

Full rationale, hosting, and cost trajectory: [`docs/deployment-plan.md`](../../../docs/deployment-plan.md).

## Decision log

The numbered records — context, decision, consequences, and what would justify revisiting —
live in [`references/decision-log.md`](references/decision-log.md). Load it when a task touches
one of these areas, or when someone asks why a thing is the way it is:

| # | Decision |
| :-- | :-- |
| 1 | LiveKit owns realtime; backend is stateless REST (Option B) |
| 2 | No custom WebSocket gateway for game state |
| 3 | Position rides lossy data messages, interpolated client-side |
| 4 | Presence = participant events live, webhooks for persistence |
| 5 | Proximity A/V is client-driven subscribe/unsubscribe |
| 6 | Postgres owns accounts and durable config only — never game state |
| 7 | No Redis until Phase 3+, and never for movement/presence |
| 8 | Shared message shapes live in `packages/protocol` / `packages/shared-types` |
| 9 | Auth = JWT; LiveKit identity is the JWT `sub` |
| 10 | Multi-tenancy via Postgres row-level security (Phase 4) |
| 11 | Local-only through Phase 3; first cloud deploy at Phase 4 (DO App Platform, BLR1) |
| 12 | LiveKit Cloud, not a self-hosted SFU |
| 13 | pnpm workspaces + Turborepo monorepo with fixed app boundaries |

## Package boundaries

- `apps/backend` — NestJS REST: `auth`, `users`, `spaces`, `realtime` (token / presence /
  movement / proximity), `tenants`, `media`, `chat`, `audit`, `prisma`, `mail`, `redis`,
  `config`, `common`. Stateless per request.
- `apps/frontend` — Phaser/PixiJS game client: `game` (map, collision, player), `net`, `media`,
  `state`, `ui`. Talks to LiveKit directly; talks to the backend only over REST.
- `apps/web` — Next.js marketing/dashboard surface (port 3200). Separate from the game client;
  do not merge them.
- `packages/protocol` — LiveKit data-message schema + version. Every wire shape is defined here
  once and imported by both sides.
- `packages/shared-types` — cross-app TypeScript types.
- `packages/config` — shared lint/tsconfig/env schema.
- `infra/` — `docker/` (local Postgres, Redis, LiveKit), `k8s/`, `terraform/` (from Phase 4).

Rules: the frontend never imports backend internals; neither app defines a wire shape locally;
`apps/web` and `apps/frontend` share nothing but `packages/*`.

## Where state is allowed to live

1. **Ephemeral, per-tick (position, who's in the room right now)** → LiveKit only. Never the DB,
   never backend memory.
2. **Durable account/config (users, login codes, spaces, layout, objects, presence metadata)** →
   Postgres via Prisma.
3. **Client-only (camera, interpolation buffers, UI state)** → `apps/frontend/src/state`.
4. **Cache / rate-limit counters** → Redis, and only from Phase 3+ when there's a real need.

If a proposal needs a fourth home, that's an architecture change — raise it.

## Sequencing constraints (they are architectural)

- The **frontend/game-dev person is the bottleneck through Phase 3** — sequence work around it.
- **No enterprise plumbing early**: SSO, SCIM, audit tooling, and SOC 2 are Phase 5+. No
  multi-tenant abstractions before Phase 4.
- Phase 2 (proximity A/V) backend and frontend are **tightly coupled — pair, don't parallelize**.
- Phase status lives in the roadmap in `CLAUDE.md`; check it before claiming something exists.

## Applying this skill

When asked to design or review something:

1. Name which decisions the work touches (by number).
2. Fit the work inside them — pick the module, the state home, and the wire shape they imply.
3. If it doesn't fit, state the conflict, the cost of complying, and the amendment you'd make.
   A new decision gets appended to the decision log with the same fields as the rest.
