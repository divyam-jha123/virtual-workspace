# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (lockfile + workspace manifests live there):
#   docker build -f tools/asset-manager/Dockerfile -t vorkium/asset-manager:dev .
#
# One container runs both processes: the Express API (/v1 + /api) on 3300 and the
# Next.js UI on 3301. Postgres is a separate service (see docker-compose).

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------------------------------------------------------------- dependencies
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tools/asset-manager/package.json tools/asset-manager/
COPY apps apps
COPY packages packages
COPY scripts scripts
COPY tools/map-mcp/package.json tools/map-mcp/

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter asset-manager...

# ---------------------------------------------------------------------- build
FROM deps AS build
COPY tools/asset-manager tools/asset-manager
RUN pnpm --filter asset-manager exec prisma generate \
 && pnpm --filter asset-manager build

# -------------------------------------------------------------------- runtime
FROM build AS runtime
ENV NODE_ENV=production
WORKDIR /app/tools/asset-manager
EXPOSE 3300 3301
COPY tools/asset-manager/docker-entrypoint.sh /usr/local/bin/asset-manager-entrypoint
RUN chmod +x /usr/local/bin/asset-manager-entrypoint
ENTRYPOINT ["/usr/local/bin/asset-manager-entrypoint"]
