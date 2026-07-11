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

## Running the frontend

The frontend is a PixiJS app served by Vite. To run it on your machine:

**Prerequisites**

- Node.js 20+
- pnpm 10 — the repo pins a version, so the easiest way is `corepack enable`
  (bundled with Node 20+)

**Steps**

```bash
# 1. clone and enter the repo
git clone https://github.com/divyam-jha123/virtual-workspace.git
cd virtual-workspace

# 2. install workspace dependencies — run from the repo ROOT (it's a pnpm workspace)
pnpm install

# 3. start the Vite dev server
pnpm --filter frontend dev
```

Then open **http://localhost:5173** in your browser.

**Once it's running**

1. Pick a map, then choose a character.
2. Walk around and try the office:

| Action | Control |
| ------ | ------- |
| Move | `W` `A` `S` `D` or the arrow keys |
| Sit down | walk onto any chair, sofa, or meeting-table seat — the avatar sits automatically |
| Stand up | move again while seated |
| Zoom in / out | mouse wheel / trackpad scroll |
| Change map | `Esc`, or the **Exit** button |
| Toggle debug overlay (tile + FPS) | `` ` `` (backtick) |

The frontend on its own runs single-player, so you don't need the backend or LiveKit just to explore the map and movement. To actually see other people moving on the same map, run the backend and a LiveKit server too (see the next section). Audio/video comes in a later phase.

**Troubleshooting**

- Run `pnpm install` from the repository root, not from `apps/frontend` — installing
  inside a sub-package won't resolve the workspace.
- `pnpm: command not found` → run `corepack enable`, then retry.
- If port `5173` is in use, Vite prints the port it fell back to — open that URL instead.

## Playing together (multiplayer)

The frontend alone is single-player. To see other people on the same map, you also need the backend running plus a LiveKit server for the avatars to sync through. Positions travel over LiveKit directly, so the backend's only job here is handing out a join token.

**1. Get a LiveKit server.** Two ways:

Local (easiest, no account):

```bash
brew install livekit    # one-time (macOS). Other OSes: https://docs.livekit.io/home/self-hosting/local/
livekit-server --dev    # runs on ws://localhost:7880 with dev keys (devkey / secret)
```

Or LiveKit Cloud (free): create a project at https://cloud.livekit.io and copy the URL, API key and secret from Settings → Keys.

**2. Create a `.env` in the repo root** (it's git-ignored):

```bash
LIVEKIT_URL=ws://localhost:7880   # or your wss://<project>.livekit.cloud URL
LIVEKIT_API_KEY=devkey            # use "devkey" for the local dev server
LIVEKIT_API_SECRET=secret         # use "secret" for the local dev server
PORT=3100                         # backend port (3000 is often already in use)
```

**3. Run all three**, each in its own terminal, from the repo root:

```bash
livekit-server --dev                                                # LiveKit (skip if using Cloud)
pnpm --filter backend dev                                           # backend (reads .env)
VITE_BACKEND_URL=http://localhost:3100 pnpm --filter frontend dev   # frontend, pointed at the backend
```

If you set `PORT=3000` instead, you can drop the `VITE_BACKEND_URL=...` part.

**4. Try it.** Open two windows on the same map — one normal, one Incognito, so they count as two different people — at **http://localhost:5173**. Pick a character in each and walk around. You'll see each other move in real time, each as the character you picked. Close a window and that avatar disappears for the other.

**Troubleshooting**

- Backend won't start, `Missing required environment variables` → you don't have a `.env` yet (or it's missing a key). Copy the block above.
- Backend won't start, `EADDRINUSE` → that port is taken; change `PORT` in `.env` and match `VITE_BACKEND_URL`.
- You don't see the other person → both windows must be on the same map, and open the browser console: if it says `running offline`, the frontend couldn't reach the backend (wrong port, or the backend isn't running).
- Both windows show up as the same person → use one normal and one Incognito window (each needs its own saved character).

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
