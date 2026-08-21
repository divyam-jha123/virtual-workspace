## Virtual Space for Enterprises


A **spatial collaboration platform** — a Gather-style virtual office where users move
avatars around a 2D map and get **proximity-based audio/video**: you hear and see the people
near you, and conversations naturally fade as you walk away. The goal is to make remote
presence feel spatial and spontaneous instead of scheduled and gridded.

> Status: Phase 1 (spatial MVP) in progress. See [`CLAUDE.md`](./CLAUDE.md) for the
> architecture and phased build roadmap, and [`docs/deployment-plan.md`](./docs/deployment-plan.md)
> for hosting and cost. Jump to [Getting started](#getting-started) to run it.

## What it does

- **Move your avatar** around a shared 2D space in real time.
- **Proximity audio/video** — audio/video subscriptions turn on/off based on how close you
  are to others, with volume fading by distance.
- **Multiple spaces**, screen-share, and chat (later phases).
- **Maps are authored through tooling in `tools/`** — a map MCP server that writes Tiled
  files, using art that lives on the filesystem under `content/`.
- Built toward **multi-tenant org accounts** and enterprise hardening (SSO, SCIM, audit
  logs, data residency) down the line.

## Tech stack

| Layer            | Choice                                                        |
| ---------------- | ------------------------------------------------------------- |
| Backend          | NestJS **stateless REST API** (no custom WebSocket gateway)    |
| Database         | PostgreSQL via Prisma                                         |
| Realtime transport | LiveKit data messages + participant events                  |
| Cache / queues   | Redis — **not used until Phase 3+**, never for game state      |
| Real-time A/V    | LiveKit (LiveKit Cloud)                                       |
| Frontend         | Phaser / PixiJS game engine + UI overlay                      |
| Monorepo tooling | pnpm workspaces + Turborepo, TypeScript throughout            |
| Map & art tooling | Tiled maps authored via an MCP server; art is files under `content/` |

## Repository layout

```
virtual-workspace/
├── apps/
│   ├── backend/     # NestJS stateless REST API (auth, LiveKit tokens, CRUD, webhooks)
│   └── frontend/    # Phaser/PixiJS game client + UI overlay
├── packages/
│   ├── shared-types # TypeScript types shared across apps
│   ├── protocol     # LiveKit data-message schema + versioning
│   └── config       # shared lint/tsconfig/env config
├── tools/
│   └── map-mcp/     # MCP server that authors Tiled maps in content/
├── content/         # the map workspace: maps/, tilesets/, assets/ (opened in Tiled)
├── infra/docker/    # two compose files — see "Services and containers"
├── docs/            # proposal and design docs
└── scripts/
```

## Getting started

There are **two separate stacks** in this repo, and you rarely need both at once:

| I want to... | Start this |
|---|---|
| walk an avatar around, test multiplayer | the **product** stack — backend + frontend + Postgres (+ LiveKit) |
| design a map, open it in Tiled | the **map MCP** — no server, no database; art is files under `content/` |

Both share `pnpm install` from the repo root (it is a pnpm workspace — never install inside a
sub-package).

```bash
pnpm install          # once, from the repo ROOT
corepack enable       # if `pnpm: command not found`
```

### Services and containers

Two compose files, deliberately separate:

| Compose file | Runs | Ports |
|---|---|---|
| `docker-compose.yml` | product Postgres | `5432` |
| `docker-compose.map-mcp.yml` | the map MCP image | none |

`map-mcp` is **not a daemon** — `docker compose up` is the wrong verb for it. The MCP client
starts one container per session and talks over stdin/stdout; that compose file exists to build
the image and document the runtime contract.

In this repo it runs straight off `node` via `.mcp.json`, which points at
`tools/map-mcp/dist/index.js`. **`dist/` is not committed**, so on a fresh clone build it once
or the MCP silently fails to start:

```bash
pnpm --filter map-mcp build
```

### Start the product stack

```bash
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres on :5432
pnpm --filter backend prisma:migrate                      # create the schema
pnpm --filter backend dev                                 # needs a root .env
pnpm --filter frontend dev                                # http://localhost:5173
```

The frontend alone is single-player and needs none of the above. See
[Database (Postgres)](#database-postgres) for DB setup and
[Playing together (multiplayer)](#playing-together-multiplayer) for the `.env` + LiveKit steps.

### Start the map MCP

There is **no server and no database** to start. The MCP runs on demand over stdio (Claude Code
launches it per session via `.mcp.json`), and it reads art straight from `content/`. The only
setup on a fresh clone is building it once, because `dist/` is not committed:

```bash
pnpm --filter map-mcp build     # then ask Claude Code to design a map
```

See [Designing maps](#designing-maps) below for the workflow and
[`tools/map-mcp/README.md`](./tools/map-mcp/README.md) for the tool reference.

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

## Database (Postgres)

The backend persists user accounts in PostgreSQL via [Prisma](https://www.prisma.io/). As of
Phase 1 the backend **won't boot without a database** — it fails fast if `DATABASE_URL` is
missing. A ready-to-use local Postgres ships in `infra/docker`.

**Prerequisites**

- Docker (Docker Desktop on macOS/Windows)

**Steps** — run from the repo root:

```bash
# 1. start local Postgres (postgres:16, on localhost:5432)
docker compose -f infra/docker/docker-compose.yml up -d

# 2. add DATABASE_URL to your root .env (see the .env block in the next section)
#    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/virtual_workspace

# 3. apply the schema and generate the Prisma client
pnpm --filter backend prisma:migrate     # creates the User table

# 4. (optional) seed a couple of dev users
pnpm --filter backend db:seed
```

To inspect the data:

```bash
docker compose -f infra/docker/docker-compose.yml exec postgres \
  psql -U postgres -d virtual_workspace -c 'SELECT email, "displayName" FROM "User";'
```

**Troubleshooting**

- `P1010: User was denied access` or `role "postgres" does not exist` → you already have another
  Postgres bound to port `5432` (commonly a Homebrew `postgresql@N` service) shadowing the Docker
  one. Stop it (`brew services stop postgresql@14`) or change the host port in
  `infra/docker/docker-compose.yml` (e.g. `5433:5432`) and match it in `DATABASE_URL`.
- `Can't reach database server at localhost:5432` → the container isn't up; run step 1 and check
  `docker compose -f infra/docker/docker-compose.yml ps` shows it `healthy`.

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

# Postgres — see the "Database (Postgres)" section above
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/virtual_workspace
```

The backend also needs Postgres running and migrated — see [Database (Postgres)](#database-postgres) above.

**3. Run all three**, each in its own terminal, from the repo root:

```bash
livekit-server --dev                                                # LiveKit (skip if using Cloud)
pnpm --filter backend dev                                           # backend (reads .env)
VITE_BACKEND_URL=http://localhost:3100 pnpm --filter frontend dev   # frontend, pointed at the backend
```

If you set `PORT=3000` instead, you can drop the `VITE_BACKEND_URL=...` part.

**4. Try it.** Open two windows on the same map — one normal, one Incognito, so they count as two different people — at **http://localhost:5173**. Pick a character in each and walk around. You'll see each other move in real time, each as the character you picked. Close a window and that avatar disappears for the other.

**Troubleshooting**

- Backend won't start, `Missing required environment variables` → you don't have a `.env` yet (or it's missing a key such as `DATABASE_URL`). Copy the block above.
- Backend won't start, `Can't reach database server` or a Prisma `P1010` error → Postgres isn't running or migrated; see [Database (Postgres)](#database-postgres).
- Backend won't start, `EADDRINUSE` → that port is taken; change `PORT` in `.env` and match `VITE_BACKEND_URL`.
- You don't see the other person → both windows must be on the same map, and open the browser console: if it says `running offline`, the frontend couldn't reach the backend (wrong port, or the backend isn't running).
- Both windows show up as the same person → use one normal and one Incognito window (each needs its own saved character).

## Designing maps

Maps are Tiled `.tmj` files in `content/maps/`, built by asking Claude Code (which drives the
**map MCP**) and reviewed by opening them in Tiled. The architecture is deliberately small —
**no asset database, no asset service**. Tiled is the source of truth for maps, the filesystem
is the source of truth for art, and the MCP is the thing in the middle that reads both.

```
        Claude Code
            │
            │ MCP (stdio)
            ▼
        ┌─────────────┐
        │   Map MCP   │   map tools · tileset tools · preview · validation
        └──────┬──────┘
          ┌────┴─────┐
          ▼          ▼
        Tiled      Assets
      .tmj/.tsj   content/
          │
          ▼
        Phaser  (game — future; today you review in Tiled)
```

| Component | Responsibility |
|---|---|
| **Claude Code** | Drives the MCP tools to author a map on your behalf |
| **Map MCP** (`tools/map-mcp`) | Create/read/update/validate maps; discover tilesets and assets from `content/` |
| **Tiled** | The map format (`.tmj`) and the review surface — source of truth for maps |
| **Assets** (`content/`) | Tilesets (`.tsj` + `.png`) and the asset catalog — source of truth for art, on the filesystem |
| **Phaser** | Loads the finished `.tmj` in-game (a later phase; not wired yet) |

### How art lives on the filesystem

There is no importer and no library service. Art is just files under `content/`:

```
content/
├── assets/
│   └── catalog.json      # asset records: id, category, tileSize, tilesetId, tileId, collision…
└── tilesets/
    ├── <pack>.tsj        # a Tiled tileset (JSON) — the only kind a map may reference
    └── <pack>.png        # the atlas image the .tsj names
```

The MCP discovers everything by **scanning those folders** at call time — `search_assets` reads
`content/assets/*.json`, and `list_tilesets` reports whatever `.tsj` files are present in
`content/tilesets/`. Add a pack by dropping its files in; there is nothing to register.

### Adding a new asset pack

```
Download / buy an asset pack
        ↓
Put its .tsj + .png in content/tilesets/,
add asset records to content/assets/catalog.json
        ↓
MCP discovers the tileset (list_tilesets / search_assets)
        ↓
Ask Claude to place it → build the .tmj
        ↓
Open content/maps/<name>.tmj in Tiled to review (Phaser later)
```

A tileset is a sheet of pixels; a **catalog record** turns one tile into placeable art — "tile
21 is a 2×2 desk that blocks movement and seats one." A `.tsj` with no matching catalog record
is still a valid tileset, it just won't show up in `search_assets`. See
[`content/assets/README.md`](./content/assets/README.md) for the record shape and
[`content/tilesets/README.md`](./content/tilesets/README.md) for the tileset files.

**This repo ships code, not art.** The vendored `*.png`/`*.tsj` and `content/assets/catalog.json`
are gitignored, so on a fresh clone the library starts empty — bring your own:

- [Kenney](https://kenney.nl/assets) — CC0, no attribution required, the easiest start
- [Modern Exteriors / Modern Office by LimeZu](https://limezu.itch.io/modernexteriors) — the
  first commercial pack used here; **purchased, not redistributed** (check its license before
  committing anything, and record it in each asset's `source.license`)
- [OpenGameArt](https://opengameart.org/) / [itch.io](https://itch.io/game-assets) — check each
  pack's license

Aim for **16×16** art — that is the project tile size, and `search_assets` filters out art drawn
for another grid because it cannot be placed on the map at all.

### Building a map

Just ask. The MCP tools handle the rest:

- `search_assets` — find art; pass `showArt` to see the actual sprites and choose by eye
- `place_asset` / `place_tiles` / `add_object` — build the map
- `validate_map` — check it against the project conventions
- `save_map` — refuses to write an invalid map, so if it saves, Tiled will open it

**Every map needs a spawn point**, or `save_map` blocks with `spawn-missing`. That one catches
everyone. A map may only reference tilesets that are real `.tsj` files in `content/tilesets/`,
because Tiled and the game load them straight from disk.

### Reviewing the result

Open `content/maps/<name>.tmj` in [Tiled](https://www.mapeditor.org/). The game does not render
these maps yet — Tiled is the review surface.

Design notes for this tooling: [`docs/map-design-mcp-plan.md`](./docs/map-design-mcp-plan.md)
and [`tools/map-mcp/README.md`](./tools/map-mcp/README.md).

## Architecture at a glance

- **Movement & presence** ride LiveKit data messages and participant events, interpolated on
  the client. The backend does **not** broadcast position and runs **no** Redis pub/sub for
  game state — that is what keeps it stateless and horizontally scalable.
- **Proximity A/V** — the backend issues LiveKit tokens and drives subscribe/unsubscribe on
  a distance threshold; the frontend attaches/detaches tracks and handles distance-based
  volume, mute, and camera.
- **Shared contracts** for all LiveKit data messages live in `packages/protocol` +
  `packages/shared-types` — never redefined per app.

## Roadmap

Phase 0 (de-risk) → Phase 1 (spatial MVP) → Phase 2 (proximity A/V) → Phase 3 (multi-space,
screen-share, chat) → Phase 4 (multi-tenancy) → Phase 5 (enterprise hardening) →
Phase 6 (scale + SOC 2). Full detail, with a trackable checklist per phase, in
[`CLAUDE.md`](./CLAUDE.md).

## Team

A two-person team: one owns the frontend + game engine, one owns the backend.
