# ── Build stage ─────────────────────────────────────────────────────────
# node:22-slim (Debian) on purpose: busybox `df`/`ps` on Alpine skews some
# systeminformation readings.
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY shared shared
COPY server server
COPY web web
RUN npm run build

# ── Runtime stage ───────────────────────────────────────────────────────
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

# procps: systeminformation shells out to `ps` for the process list on Linux —
# without it the Processes card is silently empty
RUN apt-get update \
  && apt-get install -y --no-install-recommends procps \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist

ENV WEB_DIST=/app/web/dist
EXPOSE 3000

CMD ["node", "server/dist/server/src/index.js"]
