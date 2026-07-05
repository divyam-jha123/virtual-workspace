## Virtual Space for Enterprises


A **spatial collaboration platform** — a Gather-style virtual office where users move
avatars around a 2D map and get **proximity-based audio/video**: you hear and see the people
near you, and conversations naturally fade as you walk away. The goal is to make remote
presence feel spatial and spontaneous instead of scheduled and gridded.

> Status: early scaffolding. See [`CLAUDE.md`](./CLAUDE.md) for the architecture and phased
> build roadmap, and [`docs/proposal.md`](./docs/proposal.md) for the full proposal.

## What it does

- **Move your avatar** around a shared 2D space in real time.
- **Proximity audio/video** — audio/video subscriptions turn on/off based on how close you
  are to others, with volume fading by distance.
- **Multiple spaces**, screen-share, and chat (later phases).
- Built toward **multi-tenant org accounts** and enterprise hardening (SSO, SCIM, audit
  logs, data residency) down the line.

## Tech stack

| Layer            | Choice                                                        |
| ---------------- | ------------------------------------------------------------- |
| Backend          | NestJS + WebSocket gateway                                    |
| Database         | PostgreSQL via Prisma                                         |
| Cache / pub-sub  | Redis                                                         |
| Real-time A/V    | LiveKit (LiveKit Cloud)                                       |
| Frontend         | Phaser / PixiJS game engine + UI overlay                      |
| Monorepo tooling | pnpm workspaces + Turborepo, TypeScript throughout            |

## Repository layout

```
virtual-workspace/
├── apps/
│   ├── backend/     # NestJS API + WebSocket gateway (realtime, presence, media, chat, ...)
│   └── frontend/    # Phaser/PixiJS game client + UI overlay
├── packages/
│   ├── shared-types # TypeScript types shared across apps
│   ├── protocol     # WebSocket event/message contracts
│   └── config       # shared lint/tsconfig/env config
├── infra/           # docker (local Postgres/Redis/LiveKit), k8s, terraform
├── docs/            # proposal and design docs
└── scripts/
```

## Getting started

> The workspace scaffolding is in place; `package.json` files and app code are being added
> incrementally. Once they exist, the expected workflow is:

```bash
pnpm install                 # install workspace dependencies
docker compose up            # local Postgres + Redis + LiveKit (from infra/docker)
pnpm dev                     # run backend + frontend together (turbo)

# or run a single app:
pnpm --filter backend dev
pnpm --filter frontend dev
```

## Architecture at a glance

- **Movement & presence** broadcast via Redis pub/sub; the WebSocket gateway fans out to
  clients in the same space.
- **Proximity A/V** — the backend issues LiveKit tokens and drives subscribe/unsubscribe on
  a distance threshold; the frontend attaches/detaches tracks and handles distance-based
  volume, mute, and camera.
- **Shared contracts** for all WebSocket events live in `packages/protocol` +
  `packages/shared-types` — never redefined per app.

## Roadmap

Phase 0 (de-risk) → Phase 1 (spatial MVP) → Phase 2 (proximity A/V) → Phase 3 (multi-space,
screen-share, chat) → Phase 4 (multi-tenancy) → Phase 5 (enterprise hardening) →
Phase 6 (scale + SOC 2). Full detail, with a trackable checklist per phase, in
[`CLAUDE.md`](./CLAUDE.md).

## Team

A two-person team: one owns the frontend + game engine, one owns the backend.
