# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.6 AS base
WORKDIR /app

ENV BUN_INSTALL_CACHE_DIR=/root/.bun/install/cache

FROM base AS workspace-manifests

COPY package.json ./
COPY bun.lock ./
COPY tsconfig.json ./
COPY turbo.json ./

COPY apps/Web/package.json ./apps/Web/package.json
COPY apps/APIs/package.json ./apps/APIs/package.json
COPY packages/DB/package.json ./packages/DB/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

FROM workspace-manifests AS install-dev

RUN --mount=type=cache,target=/root/.bun/install/cache \
	bun install --frozen-lockfile --ignore-scripts

FROM workspace-manifests AS install-prod

RUN --mount=type=cache,target=/root/.bun/install/cache \
	bun install --frozen-lockfile --production --ignore-scripts

FROM base AS source

COPY package.json ./
COPY bun.lock ./
COPY tsconfig.json ./
COPY turbo.json ./

COPY apps/Web ./apps/Web
COPY packages/contracts ./packages/contracts

FROM base AS build

ARG NODE_ENV=production
ARG VITE_API_URL=http://localhost:8000

ENV NODE_ENV=${NODE_ENV}
ENV VITE_API_URL=${VITE_API_URL}

COPY --from=install-dev /app/node_modules ./node_modules
COPY --from=install-dev /app/apps/Web/node_modules ./apps/Web/node_modules
COPY --from=install-dev /app/packages/contracts/node_modules ./packages/contracts/node_modules

COPY --from=source /app/apps/Web ./apps/Web
COPY --from=source /app/packages/contracts ./packages/contracts

WORKDIR /app/apps/Web

RUN bun run build

FROM base AS development

ARG NODE_ENV=development
ARG VITE_API_URL=http://localhost:8000

ENV NODE_ENV=${NODE_ENV}
ENV VITE_API_URL=${VITE_API_URL}
ENV PORT=5173

RUN apt-get update \
	&& apt-get install -y --no-install-recommends wget bash \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=install-dev /app/node_modules ./node_modules
COPY --from=install-dev /app/apps/Web/node_modules ./apps/Web/node_modules
COPY --from=install-dev /app/packages/contracts/node_modules ./packages/contracts/node_modules

COPY --from=source /app/apps/Web ./apps/Web
COPY --from=source /app/packages/contracts ./packages/contracts
COPY docker/scripts/ensure-bun-workspace-install.sh /usr/local/bin/ensure-bun-workspace-install

RUN chmod +x /usr/local/bin/ensure-bun-workspace-install

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
	CMD wget --no-verbose --tries=1 --spider http://localhost:5173 || exit 1

CMD ["bash", "-lc", "ensure-bun-workspace-install && cd /app/apps/Web && bun run dev --host 0.0.0.0"]

FROM base AS production

ENV NODE_ENV=production
ENV PORT=5173

RUN apt-get update \
	&& apt-get install -y --no-install-recommends wget \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=install-prod /app/node_modules ./node_modules
COPY --from=install-prod /app/apps/Web/node_modules ./apps/Web/node_modules
COPY --from=install-prod /app/packages/contracts/node_modules ./packages/contracts/node_modules

COPY --from=build /app/apps/Web/dist ./dist
COPY --from=source /app/apps/Web/package.json ./package.json

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
	CMD wget --no-verbose --tries=1 --spider http://localhost:5173 || exit 1

CMD ["bun", "x", "serve", "dist", "-l", "5173"]
