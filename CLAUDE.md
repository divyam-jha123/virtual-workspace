# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## Project

**Virtual Space for Enterprises (India)** — a spatial collaboration platform (Gather-style
virtual office): users move avatars around a 2D map and get **proximity-based audio/video** —
you hear/see people near you, and conversations fade as you walk away.

## pushing rules to github (for automated push by claude)

**commands**
commit - git commit -m "<commit message>"
in commit message dont put "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" these line. commit messages should be one linners only


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

Track progress by checking items off as they land. Each phase is split into backend and
frontend enhancement issues, plus one checkbox at the end for the phase's overall goal
(quoted from the build roadmap doc).

### Phase 0 — De-risk & Scaffold (1–2 wk)

**Backend**
- [ ] Monorepo + NestJS skeleton
- [ ] WebSocket gateway echo
- [ ] LiveKit spike — get one audio track flowing between two clients

**Frontend**
- [ ] Render a tilemap
- [ ] Move an avatar with keyboard input
- [ ] Open a WS connection sending position

**Goal**
- [ ] **Phase goal:** Two browsers show two avatars moving on a shared map, and a raw LiveKit call works between them.

### Phase 1 — Spatial MVP (3–4 wk)

**Backend**
- [ ] Position broadcast via Redis pub/sub
- [ ] Room/presence state (join/leave)
- [ ] User model
- [ ] Simple JWT auth

**Frontend**
- [ ] Collision layer
- [ ] Smooth local movement + interpolation of remote avatars
- [ ] Name tags
- [ ] Presence list

**Goal**
- [ ] **Phase goal:** 5–10 users in one room see each other move smoothly; refresh drops you back in.

### Phase 2 — Proximity A/V (3–5 wk)

> ⚠️ Tightly coupled — pair on this, don't parallelize.

**Backend**
- [ ] Proximity computation
- [ ] LiveKit token issuance
- [ ] Drive subscribe/unsubscribe on movement
- [ ] Handle churn

**Frontend**
- [ ] LiveKit client integration
- [ ] Attach/detach tracks on proximity events
- [ ] Distance-based volume
- [ ] Mute/camera controls
- [ ] Private-area support

**Goal**
- [ ] **Phase goal:** Walking near someone connects A/V, walking away disconnects.

### Phase 3 — Product Surface (4–6 wk)

**Backend**
- [ ] Multiple spaces/maps
- [ ] Spawn points
- [ ] Interactive objects
- [ ] Screen-share signaling
- [ ] Layout persistence

**Frontend**
- [ ] Map loader (or basic editor)
- [ ] Interactable tiles
- [ ] Screen-share UI
- [ ] Text chat
- [ ] Emotes

**Goal**
- [ ] **Phase goal:** An org can have several rooms, share screens, drop into meeting areas, and text chat.

### Phase 4 — Multi-tenancy & Org Accounts (3–5 wk)

**Backend**
- [ ] Tenant model
- [ ] Org/workspace boundaries
- [ ] Roles (admin/member/guest)
- [ ] Invites
- [ ] Tenant isolation

**Frontend**
- [ ] Org onboarding
- [ ] Admin panel basics
- [ ] Member management

**Goal**
- [ ] **Phase goal:** Two separate companies use the platform fully isolated from each other.

### Phase 5 — Enterprise Hardening (6–10 wk)

**Backend**
- [ ] SSO (SAML/OIDC)
- [ ] SCIM provisioning
- [ ] Audit logs
- [ ] Rate limiting
- [ ] Secrets management
- [ ] Observability
- [ ] Backups
- [ ] India data-residency

**Frontend**
- [ ] SSO login flows
- [ ] Audit views
- [ ] SCIM sync UI

**Goal**
- [ ] **Phase goal:** An IT admin can wire up SSO + auto-provisioning and see audit logs.

### Phase 6 — Scale & Compliance (ongoing)

**Backend**
- [ ] Horizontal scaling of WS + proximity workers
- [ ] LiveKit/SFU tuning
- [ ] Load testing
- [ ] Disaster recovery
- [ ] SOC 2 Type I → II path

**Goal**
- [ ] **Phase goal:** Your load target holds and you have a SOC 2 Type I report.

## Working constraints (read before planning work)

- The **frontend/game-dev person is the bottleneck** through Phase 3 — sequence work around that.
- **Don't build enterprise plumbing early.** No SSO/SCIM/SOC 2 (Phase 5) before the product
  is validated. Avoid premature multi-tenant abstractions before Phase 4.
- SOC 2 is a 6–12 month parallel process, not a sprint.

## Deployment targets

- Backend + WS: Railway / Render / Fly.io (all handle WebSockets, push-to-deploy).
- Frontend: Vercel / Netlify / Cloudflare Pages (static build).
- Postgres: Neon / Supabase. Redis: Upstash. India-region infra later via `infra/terraform`.
