# Deployment Plan (DigitalOcean)

> Source of truth for deployment. Derived from the build-roadmap doc and mapped to the
> Enterprise-India roadmap (Phases 0–6). This project uses **Option B**: LiveKit is the
> entire real-time layer; the NestJS backend is a **stateless REST service**.

## 1. Architecture under Option B — what runs where

| Concern | Handled by | On DigitalOcean? |
| :-- | :-- | :-- |
| Audio / video | LiveKit Cloud | No — external |
| Avatar position broadcast | LiveKit data messages (lossy, client-interpolated) | No — external |
| Presence (join/leave/list) | LiveKit room participant events | No — external |
| Text chat | LiveKit data messages (reliable) | No — external |
| Screen share | LiveKit track publish | No — external |
| Auth, LiveKit token issuance, CRUD, webhooks | NestJS REST API | Yes |
| Frontend (Phaser/PixiJS + React overlay) | Static build | Yes |
| Postgres | Neon (→ India-region DB at Phase 5) | No — external (early) |
| Redis | None at MVP. Reappears Phase 3+ only for rate-limit/cache/queues | Later, if needed |

The core simplification: through Phase 3, LiveKit absorbs A/V, position, presence, chat, and
screen-share. The backend never holds a WebSocket for game state — it's request/response
only. That means **no sticky sessions, no Redis pub/sub**, and horizontal scaling = bump the
instance count. No Redis at all until rate-limiting or caching is actually needed.

## 2. Which DigitalOcean product — and when

| Product | What it is | Ops burden | Use it |
| :-- | :-- | :-- | :-- |
| App Platform | PaaS: GitHub auto-deploy, managed TLS, buildpack/Dockerfile, static sites, instance-count scaling | Lowest | Phase 4 → 5 (first deploy; default) |
| Droplet | Raw VM; you own OS, TLS, firewall, deploys | High | Only if you need VM-level control or cheapest raw compute |
| DOKS (Kubernetes) | Managed k8s + worker Droplets + LB | Medium-high | Phase 6 scale |

**Recommendation:** start and stay on **App Platform** as long as it holds. Automatic HTTPS
on `workium.cc`, push-to-deploy, and instance scaling with zero server management — exactly
what a two-person team wants. Move to DOKS only when Phase 6 scale/DR/compliance justifies
it.

**Region: Bangalore (BLR1)** for India latency.

## 3. Phase-by-phase deployment

> **Phases 0–3 are local development only.** We run everything on **local Docker** + **LiveKit
> Cloud (free Build tier)** while building — **no DigitalOcean hosting is provisioned yet**.
> The first real cloud deploy is at **Phase 4** (pilot-ready). The Phase 1–3 subsections below
> describe the *target* topology for each capability — reference for when you deploy, not work
> to do now.

### Phase 0 — De-risk & Scaffold
Prove the two scary things (position over LiveKit data channel + one audio track) locally.
- GitHub monorepo; local Docker for Postgres + NestJS dev.
- Create free accounts: LiveKit Cloud (Build tier), Neon (free tier). DigitalOcean not needed
  yet.
- No cloud deploy — local only.
- **Cost:** ~$0 (all local / free tiers).

### Phase 1 — Spatial MVP (local dev)
Positions + presence flow through LiveKit (Option B), not a custom WS server. Still run
locally; the topology below is the deploy target for Phase 4.
- Frontend → static build, served locally. Joins LiveKit room, publishes position as lossy
  data messages, reads participant events for presence.
- Backend → NestJS run locally. Handles JWT auth + LiveKit token minting. Just REST.
- DB → Neon free tier (or local Postgres in Docker). Redis → none.
- **Cost:** ~$0 (local + free tiers).

### Phase 2 — Proximity A/V (local dev)
Client-driven subscribe/unsubscribe on distance (positions already arriving via the data
channel); backend issues tokens.
- Same topology as Phase 1, still local.
- LiveKit → Build (free) for dev; watch WebRTC minutes as real testing ramps. Ship ($50/mo)
  only becomes relevant once a real pilot user starts daily use (Phase 4) — Build's caps are
  hard cutoffs, not overages.
- **Cost:** ~$0 (local + LiveKit free).

### Phase 3 — Product Surface (local dev)
Multiple spaces/maps, screen-share, text chat, layout persistence, interactive objects.
- Screen-share + text chat = LiveKit tracks + reliable data messages. No new infra.
- Layout/objects persistence → Postgres.
- Backend stays stateless REST — when deployed (Phase 4) it scales by instance count with no
  sticky sessions. This is the enduring Option B dividend.
- Redis re-enters only if actually needed → rate-limiting, caching, chat-history cache.
- **Cost:** ~$0 (still local dev; LiveKit free unless you run a live pilot).

### Phase 4 — Multi-tenancy & Org Accounts (first cloud deploy)
Tenant model, org boundaries, roles, invites, isolation — **and the first real deploy**.
- **First deploy to App Platform (BLR1):** backend (stateless REST) + static frontend,
  push-to-deploy from GitHub, automatic TLS on `workium.cc`. Point DB at Neon.
- Use **Postgres row-level security** for tenant isolation at this scale — no infra change,
  just schema/policies.
- Backend still stateless → scale instances as orgs grow.
- Split staging and production as separate App Platform apps.
- Introduce **Terraform** (`infra/terraform/`) now for reproducible infra — pays off for the
  audit trail in Phase 5–6.
- **Cost:** ~$50–120/mo (first month you're paying for hosting).

## 4. Cost trajectory

Phases 0–3 are local dev, so DigitalOcean compute is $0 until the first deploy at Phase 4.

| Phase | Compute (DO) | DB | Redis | LiveKit | Rough monthly |
| :-: | :-: | :-: | :-: | :-: | :-: |
| 0 | $0 (local) | Neon free | — | Build (free) | ~$0 |
| 1 | $0 (local) | Neon free | — | Build (free) | ~$0 |
| 2 | $0 (local) | Neon free | — | Build (free) | ~$0 |
| 3 | $0 (local) | Neon free | — | Build (free) | ~$0 |
| 4 | ~$25–40 | ~$15 | ~$15 | $50 | ~$60–120 |

## 5. Cross-cutting setup

- **CI/CD** — GitHub Actions for tests/lint gate from the start (Phases 0–3, local dev). App
  Platform auto-deploy on push wires up at Phase 4 (buildpack or Dockerfile).
- **Environments** — local Docker (dev, Phases 0–3) → App Platform staging → App Platform prod
  (Phase 4) → DOKS prod (Phase 6).
- **Domain/TLS** — `workium.cc` on App Platform; HTTPS automatic (from Phase 4). Add
  Cloudflare in front later if you want CDN/WAF.
- **Secrets** — local `.env` during dev; App Platform encrypted env vars from Phase 4;
  dedicated manager by Phase 5.
- **IaC** — Terraform from Phase 4 (`infra/terraform/`), mandatory by Phase 6 for audit
  reproducibility.
- **Monitoring** — Sentry once deployed (Phase 4); full metrics/logs by Phase 5.

## 6. Two decisions to park (don't solve now)

- **DB residency** — Neon has no India region, so early on Postgres sits outside India (fine
  for MVP/pilot). It collides with Phase 5 data-residency. Resolution: migrate to DO Managed
  Postgres BLR when a contract forces it. Park it.
- **LiveKit media residency** — LiveKit Cloud is global-edge; whether that satisfies strict
  India media residency is a conversation to have with LiveKit at Phase 5. Worst case =
  self-host LiveKit on BLR Droplets. Don't pre-solve.

## Bottom line

We build locally through Phase 3 — no cloud hosting, ~$0 — then, because we chose Option B,
the **first deploy at Phase 4** is trivial: one small always-on REST service + a static
frontend on App Platform (BLR1), with Neon and LiveKit as external managed services. That
topology then carries unchanged through Phase 4. The only real infra escalations are residency
at Phase 5 (Neon → DO Managed Postgres BLR) and orchestration at Phase 6 (App Platform →
DOKS). Everything hard about real-time stays LiveKit's problem.
