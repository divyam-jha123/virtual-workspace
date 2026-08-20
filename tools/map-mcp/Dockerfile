# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (the lockfile and workspace manifests live there):
#   docker build -f tools/map-mcp/Dockerfile -t vorkium/map-mcp:dev .
#
# The image carries the server and nothing else — no app source, no content, no
# secrets. `content/` arrives at run time as the single bind mount, and the asset
# API key arrives as an env var that is never baked in and never logged.

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------- dependencies
# Manifests + lockfile only, so a source edit does not bust the install cache.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tools/map-mcp/package.json tools/map-mcp/
COPY scripts/package.json scripts/
COPY packages/config/package.json packages/config/
COPY packages/protocol/package.json packages/protocol/
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/web/package.json apps/web/

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter map-mcp...

# Runtime dependencies only, resolved from the same lockfile.
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter map-mcp...

# ---------------------------------------------------------------------- build
FROM deps AS build
COPY tools/map-mcp/tsconfig.json tools/map-mcp/
COPY tools/map-mcp/src tools/map-mcp/src
RUN pnpm --filter map-mcp build

# -------------------------------------------------------------------- runtime
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    MAP_MCP_WORKSPACE=/workspace
WORKDIR /app/tools/map-mcp

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/tools/map-mcp/node_modules /app/tools/map-mcp/node_modules
COPY --from=build /app/tools/map-mcp/dist /app/tools/map-mcp/dist
COPY tools/map-mcp/package.json /app/tools/map-mcp/package.json

# The mount point exists up front so a read-only root filesystem still works.
RUN mkdir -p /workspace && chown -R node:node /workspace /app
USER node

# stdio transport: no ports, nothing listens, the process dies with the session.
ENTRYPOINT ["node", "/app/tools/map-mcp/dist/index.js"]
