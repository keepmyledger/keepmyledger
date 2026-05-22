# syntax=docker/dockerfile:1.7
#
# Multi-stage build for KeepMyLedger.
#
# Stage 1: install ALL deps and build server + web (TypeScript → JS, Vite bundle).
# Stage 2: minimal runtime — Node 22 + production deps + compiled output.
#
# The image expects DATABASE_URL=postgres://... at runtime. SQLite mode also
# works (mount a volume at /app/server/data).

# ───────────────────── Builder ────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies for native modules (sqlite, pdfjs canvas-less is fine).
RUN apk add --no-cache python3 make g++

# Copy manifests first for layer-cache friendliness.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json    ./web/

RUN npm ci --workspaces --include-workspace-root

# Now copy source and build.
COPY tsconfig*.json ./
COPY shared ./shared
COPY server ./server
COPY web    ./web

RUN npm run build -w shared \
 && npm run build -w server \
 && npm run build -w web

# ───────────────────── Runtime ────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
# `--experimental-sqlite` is required at runtime by the sqlite adapter, even
# when DATABASE_URL points at Postgres (the module is imported eagerly).
ENV NODE_OPTIONS=--experimental-sqlite

# Production-only dependencies for the server. Web is a static bundle so it
# needs no runtime deps; shared is a tiny library so we copy its dist directly.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

RUN npm ci --workspaces --include-workspace-root --omit=dev \
 && npm cache clean --force

# Compiled output from the builder.
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist    ./web/dist

# Data directory for sqlite + uploads when not using PG/Drive. Make it a volume
# mount point so platforms (Fly volumes, Railway, Render disks) can persist it.
RUN mkdir -p /app/server/data/uploads && chown -R node:node /app
VOLUME ["/app/server/data"]

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3001/api/health || exit 1

CMD ["node", "server/dist/index.js"]
