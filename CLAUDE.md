# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## Project

**Virtual Space for Enterprises (India)** — a spatial collaboration platform (Gather-style
virtual office): users move avatars around a 2D map and get **proximity-based audio/video** —
you hear/see people near you, and conversations fade as you walk away.


## Monorepo layout

pnpm workspaces + Turborepo.

- `apps/backend` — NestJS API + WebSocket gateway (realtime, presence, movement, proximity,
  media tokens, chat, audit). Prisma + PostgreSQL, Redis.
- `apps/frontend` — Phaser/PixiJS game client with a UI overlay (`src/ui`), networking
  (`src/net`), media (`src/media`), and client state (`src/state`).
- `packages/shared-types` — TypeScript types shared across apps.
- `packages/protocol` — WebSocket event/message contracts shared by client and server.
- `packages/config` — shared config (lint/tsconfig/env schema).
- `infra/` — `docker/` (local Postgres/Redis/LiveKit), `k8s/`, `terraform/`.
- `docs/`, `scripts/`, `.github/workflows/` (CI).

## Tech stack

- **Backend:** NestJS, WebSocket gateway, PostgreSQL via Prisma, Redis (pub/sub + cache).
- **Realtime A/V:** LiveKit (use **LiveKit Cloud** — do NOT self-host an SFU yet).
- **Frontend:** Phaser/PixiJS game engine + UI overlay; LiveKit client SDK.
- **Tooling:** pnpm workspaces, Turborepo, TypeScript everywhere.

## Commands

> Scripts are TBD until each `package.json` is added. Expected shape:

```bash
pnpm install            # install workspace deps
pnpm dev                # run backend + frontend (turbo)
pnpm --filter backend dev
pnpm --filter frontend dev
pnpm build              # turbo build
pnpm test               # turbo test
pnpm lint
```

Local infra: `docker compose up` from `infra/docker` (Postgres, Redis, LiveKit).

## Architecture decisions

- **Movement/presence:** avatar position broadcast via **Redis pub/sub**; the WS gateway
  fans out to clients in the same space.
- **Proximity A/V (the differentiator):** start with a single room and **dynamic
  subscribe/unsubscribe on a distance threshold**; add volume ramp later. Backend issues
  LiveKit tokens and orchestrates subscribe/unsubscribe on proximity events; frontend
  attaches/detaches tracks and handles distance-based volume, mute, and camera.
- **Shared contracts:** all WS events live in `packages/protocol` + `packages/shared-types`
  — never redefine message shapes per app.
- **Multi-tenancy (Phase 4):** decide **row-level vs schema-per-tenant** before building it;
  tenant context resolved per-request in `apps/backend/src/tenants/tenant-context`.

## Phase roadmap

- **Phase 0** (1–2 wk): de-risk — WS echo, LiveKit audio between two clients, tilemap render.
- **Phase 1** (3–4 wk): single-room spatial MVP, real-time avatars.
- **Phase 2** (3–5 wk): proximity A/V. **Tightly coupled — pair on this, don't parallelize.**
- **Phase 3** (4–6 wk): product surface — multiple spaces, screen-share, chat.
- **Phase 4** (3–5 wk): multi-tenancy + org accounts.
- **Phase 5** (6–10 wk): enterprise hardening — SSO, SCIM, audit logs, data residency.
- **Phase 6** (ongoing): scale + SOC 2 Type I → II.

Rough cumulative: proximity MVP ~2.5–3 mo · pilot-ready ~4–5 mo · enterprise-ready ~8–11 mo.

## Working constraints (read before planning work)

- The **frontend/game-dev person is the bottleneck** through Phase 3 — sequence work around that.
- **Don't build enterprise plumbing early.** No SSO/SCIM/SOC 2 (Phase 5) before the product
  is validated. Avoid premature multi-tenant abstractions before Phase 4.
- SOC 2 is a 6–12 month parallel process, not a sprint.

## Deployment targets

- Backend + WS: Railway / Render / Fly.io (all handle WebSockets, push-to-deploy).
- Frontend: Vercel / Netlify / Cloudflare Pages (static build).
- Postgres: Neon / Supabase. Redis: Upstash. India-region infra later via `infra/terraform`.
