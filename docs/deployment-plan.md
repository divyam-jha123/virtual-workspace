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
| App Platform | PaaS: GitHub auto-deploy, managed TLS, buildpack/Dockerfile, static sites, instance-count scaling | Lowest | Phase 1 → 4 (default) |
| Droplet | Raw VM; you own OS, TLS, firewall, deploys | High | Only if you need VM-level control or cheapest raw compute |
| DOKS (Kubernetes) | Managed k8s + worker Droplets + LB | Medium-high | Phase 6 scale |

**Recommendation:** start and stay on **App Platform** as long as it holds. Automatic HTTPS
on `workium.cc`, push-to-deploy, and instance scaling with zero server management — exactly
what a two-person team wants. Move to DOKS only when Phase 6 scale/DR/compliance justifies
it.

**Region: Bangalore (BLR1)** for India latency.

## 3. Phase-by-phase deployment

### Phase 0 — De-risk & Scaffold
Prove the two scary things (position over LiveKit data channel + one audio track) and the
deploy pipeline.
- GitHub monorepo; local Docker for Postgres + NestJS dev.
- Create accounts: LiveKit Cloud (Build tier, free), Neon (free tier), DigitalOcean.
- Deploy a hello-world NestJS to App Platform (BLR1) to prove push-to-deploy + TLS early —
  don't discover deploy problems in Phase 3.
- **Cost:** ~$0–5/mo (App Platform basic instance if you keep the staging app up).

### Phase 1 — Spatial MVP
Positions + presence now flow through LiveKit (Option B), not a custom WS server.
- Frontend → App Platform static site (free/near-free tier). Joins LiveKit room, publishes
  position as lossy data messages, reads participant events for presence.
- Backend → App Platform web service, smallest instance (basic-xxs, ~$5/mo). Handles JWT
  auth + LiveKit token minting. Always-on, but it's just REST.
- DB → Neon free tier. Redis → none.
- Domain/TLS → point `workium.cc` at App Platform; HTTPS automatic.
- **Cost:** ~$5–12/mo.

### Phase 2 — Proximity A/V
Client-driven subscribe/unsubscribe on distance (positions already arriving via the data
channel); backend issues tokens.
- Same topology as Phase 1.
- LiveKit → still Build (free) for dev; watch WebRTC minutes as real testing ramps. Move to
  Ship ($50/mo) the moment a real pilot user starts daily use — Build's caps are hard
  cutoffs, not overages.
- Backend instance maybe → basic-xs if load warrants.
- **Cost:** ~$12/mo + LiveKit ($0–50).

### Phase 3 — Product Surface
Multiple spaces/maps, screen-share, text chat, layout persistence, interactive objects.
- Screen-share + text chat = LiveKit tracks + reliable data messages. No new infra.
- Layout/objects persistence → Postgres (Neon may move to Launch pay-as-you-go as data grows).
- Backend → because it's stateless REST, scale by raising instance count on App Platform
  (2+ instances, no sticky sessions needed). This is the enduring Option B dividend.
- Redis re-enters only if needed → rate-limiting, caching, chat-history cache. Use Upstash
  free or DO Managed Valkey (BLR, ~$15/mo).
- LiveKit → Ship ($50/mo) for real pilot usage.
- Optional CDN (Cloudflare) in front of the static frontend.
- **Cost:** ~$50–95/mo.

### Phase 4 — Multi-tenancy & Org Accounts
Tenant model, org boundaries, roles, invites, isolation.
- Mostly app + DB layer, not deployment. Use **Postgres row-level security** for tenant
  isolation at this scale — no infra change, just schema/policies.
- Backend still stateless → scale instances as orgs grow.
- Split staging and production as separate App Platform apps.
- Introduce **Terraform** (`infra/terraform/`) now for reproducible infra — pays off for the
  audit trail in Phase 5–6.
- **Cost:** ~$50–120/mo.

## 4. Cost trajectory

| Phase | Compute (DO) | DB | Redis | LiveKit | Rough monthly |
| :-: | :-: | :-: | :-: | :-: | :-: |
| 0 | ~$0–5 | Neon free | — | Build (free) | ~$0–5 |
| 1 | ~$5–12 | Neon free | — | Build (free) | ~$5–12 |
| 2 | ~$12 | Neon free | — | $0–50 | ~$12–60 |
| 3 | ~$12–25 | Neon Launch ~$5–15 | $0–15 | $50 | ~$50–95 |
| 4 | ~$25–40 | ~$15 | ~$15 | $50 | ~$60–120 |

## 5. Cross-cutting setup

- **CI/CD** — GitHub → App Platform auto-deploy on push (buildpack or Dockerfile). Add GitHub
  Actions for tests/lint gate.
- **Environments** — local Docker (dev) → App Platform staging → App Platform prod → DOKS
  prod (Phase 6).
- **Domain/TLS** — `workium.cc` on App Platform; HTTPS automatic. Add Cloudflare in front
  from Phase 3 if you want CDN/WAF.
- **Secrets** — App Platform encrypted env vars early; dedicated manager by Phase 5.
- **IaC** — Terraform from Phase 4 (`infra/terraform/`), mandatory by Phase 6 for audit
  reproducibility.
- **Monitoring** — Sentry from Phase 2–3; full metrics/logs by Phase 5.

## 6. Two decisions to park (don't solve now)

- **DB residency** — Neon has no India region, so early on Postgres sits outside India (fine
  for MVP/pilot). It collides with Phase 5 data-residency. Resolution: migrate to DO Managed
  Postgres BLR when a contract forces it. Park it.
- **LiveKit media residency** — LiveKit Cloud is global-edge; whether that satisfies strict
  India media residency is a conversation to have with LiveKit at Phase 5. Worst case =
  self-host LiveKit on BLR Droplets. Don't pre-solve.

## Bottom line

Because we chose Option B, "full app on DigitalOcean" means one small always-on REST service
+ a static frontend on App Platform (BLR1) — nothing more — with Neon and LiveKit as external
managed services. That topology carries unchanged from Phase 1 through Phase 4. The only real
infra escalations are residency at Phase 5 (Neon → DO Managed Postgres BLR) and orchestration
at Phase 6 (App Platform → DOKS). Everything hard about real-time stays LiveKit's problem.
