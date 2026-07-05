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

- `apps/backend` — NestJS **stateless REST API** (auth, LiveKit token issuance, CRUD,
  webhooks). Prisma + PostgreSQL. The `src/realtime/*` folders hold LiveKit orchestration and
  token logic — **not** a WebSocket fan-out gateway (see Architecture decisions).
- `apps/frontend` — Phaser/PixiJS game client with a UI overlay (`src/ui`), networking
  (`src/net`), media (`src/media`), and client state (`src/state`). Talks to LiveKit directly
  for position/presence/chat/A-V.
- `packages/shared-types` — TypeScript types shared across apps.
- `packages/protocol` — LiveKit **data-message** schema + versioning shared by client and server.
- `packages/config` — shared config (lint/tsconfig/env schema).
- `infra/` — `docker/` (local Postgres/Redis/LiveKit), `k8s/`, `terraform/`.
- `docs/`, `scripts/`, `.github/workflows/` (CI).

## Tech stack

We build on **Option B** (see `docs/deployment-plan.md`): LiveKit carries the entire
real-time layer, so the backend stays a stateless REST service.

- **Backend:** NestJS **stateless REST API** (auth, LiveKit token issuance, CRUD, webhooks),
  PostgreSQL via Prisma. **No custom WebSocket gateway** for game state.
- **Realtime (position/presence/chat/screen-share) + A/V:** LiveKit (use **LiveKit Cloud** —
  do NOT self-host an SFU yet). Position rides LiveKit data messages; presence rides
  participant events.
- **Redis:** **not used until Phase 3+**, and only for rate-limiting / caching / queues —
  never for movement/presence pub/sub.
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

- **Why Option B:** LiveKit absorbs A/V + position + presence + chat + screen-share, so the
  backend stays stateless → no sticky sessions, no Redis pub/sub, horizontal scaling = bump
  the instance count. Full rationale + hosting in `docs/deployment-plan.md`.
- **Movement/presence:** avatar position and presence flow through **LiveKit data messages +
  participant events**, client-interpolated. The backend does **not** broadcast position and
  does **not** run Redis pub/sub for game state.
- **Proximity A/V (the differentiator):** single room with **client-driven dynamic
  subscribe/unsubscribe on a distance threshold** (positions already arrive on the data
  channel); add volume ramp later. The backend's only role is **LiveKit token issuance**;
  the frontend attaches/detaches tracks and handles distance-based volume, mute, and camera.
- **Shared contracts:** all LiveKit data-message shapes live in `packages/protocol` +
  `packages/shared-types` — never redefine message shapes per app.
- **Multi-tenancy (Phase 4):** use **Postgres row-level security** for tenant isolation at
  this scale (no infra change); tenant context resolved per-request in
  `apps/backend/src/tenants/tenant-context`.

## Phase roadmap

Track progress by checking items off as they land. Each phase is split into backend and
frontend enhancement issues, plus one checkbox at the end for the phase's overall goal
(quoted from the build roadmap doc).

### Phase 0 — De-risk & Scaffold (1–2 wk)

**Backend**
- [ ] Monorepo + NestJS skeleton
- [ ] Prove position + one audio track over LiveKit (data channel + track)
- [ ] LiveKit spike — get one audio track flowing between two clients
- [ ] Deploy hello-world NestJS to App Platform (BLR1) — prove push-to-deploy + TLS

**Frontend**
- [ ] Render a tilemap
- [ ] Move an avatar with keyboard input
- [ ] Join a LiveKit room and publish position as a data message

**Goal**
- [ ] **Phase goal:** Two browsers show two avatars moving on a shared map, and a raw LiveKit call works between them.

### Phase 1 — Spatial MVP (3–4 wk)

**Backend**
- [ ] LiveKit token issuance + room join
- [ ] Presence via LiveKit participant events (backend persists user/room metadata only)
- [ ] User model
- [ ] Simple JWT auth

**Frontend**
- [ ] Collision layer
- [ ] Smooth local movement + interpolation of remote avatars (positions via LiveKit data channel)
- [ ] Name tags
- [ ] Presence list (from LiveKit participant events)

**Goal**
- [ ] **Phase goal:** 5–10 users in one room see each other move smoothly; refresh drops you back in.

### Phase 2 — Proximity A/V (3–5 wk)

> ⚠️ Tightly coupled — pair on this, don't parallelize.

**Backend**
- [ ] LiveKit token issuance (scoped tokens)
- [ ] Client drives subscribe/unsubscribe on distance (positions already on the data channel)
- [ ] Webhooks / room lifecycle as needed

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
- [ ] Screen-share via LiveKit tracks; text chat via reliable data messages (no custom signaling)
- [ ] Layout persistence
- [ ] Redis *may* re-enter here for rate-limiting / caching (first use of Redis)

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
- [ ] Tenant isolation via Postgres row-level security (no infra change)
- [ ] Introduce Terraform (`infra/terraform/`); split staging/prod App Platform apps

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
- [ ] India data-residency — migrate Neon → DO Managed Postgres BLR; revisit LiveKit media residency

**Frontend**
- [ ] SSO login flows
- [ ] Audit views
- [ ] SCIM sync UI

**Goal**
- [ ] **Phase goal:** An IT admin can wire up SSO + auto-provisioning and see audit logs.

### Phase 6 — Scale & Compliance (ongoing)

**Backend**
- [ ] Horizontal scaling (App Platform → DOKS orchestration)
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

**Option B on DigitalOcean** — the topology carries unchanged from Phase 1 through Phase 4:

- Backend (stateless REST) + static frontend → **DigitalOcean App Platform, BLR1 (Bangalore)**.
  Push-to-deploy from GitHub, automatic TLS on `workium.cc`, scale by instance count.
- Postgres → **Neon** (→ DO Managed Postgres BLR at Phase 5 for India residency).
- Realtime A/V + game-state transport → **LiveKit Cloud** (Build tier → Ship at real pilot use).
- Redis → **none until Phase 3+** (Upstash or DO Managed Valkey), only for rate-limit/cache.
- India-region infra later via `infra/terraform` (introduced Phase 4); App Platform → DOKS at Phase 6.

See [`docs/deployment-plan.md`](docs/deployment-plan.md) for the full phase-by-phase plan,
cost trajectory, and parked decisions.
