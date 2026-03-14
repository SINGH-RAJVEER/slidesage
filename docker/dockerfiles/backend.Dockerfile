# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.6 AS base
WORKDIR /app

ENV BUN_INSTALL_CACHE_DIR=/root/.bun/install/cache

FROM base AS workspace-manifests

COPY package.json ./
COPY bun.lock ./
COPY tsconfig.json ./
COPY turbo.json ./

COPY apps/APIs/package.json ./apps/APIs/package.json
COPY apps/Web/package.json ./apps/Web/package.json
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

COPY apps/APIs ./apps/APIs
COPY packages/DB ./packages/DB
COPY packages/contracts ./packages/contracts

FROM base AS development

ARG NODE_ENV=development

ENV NODE_ENV=${NODE_ENV}
ENV PORT=8000

RUN apt-get update \
	&& apt-get install -y --no-install-recommends wget bash \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=install-dev /app/node_modules ./node_modules
COPY --from=install-dev /app/apps/APIs/node_modules ./apps/APIs/node_modules
COPY --from=install-dev /app/packages/DB/node_modules ./packages/DB/node_modules
COPY --from=install-dev /app/packages/contracts/node_modules ./packages/contracts/node_modules

COPY --from=source /app/apps/APIs ./apps/APIs
COPY --from=source /app/packages/DB ./packages/DB
COPY --from=source /app/packages/contracts ./packages/contracts
COPY docker/scripts/ensure-bun-workspace-install.sh /usr/local/bin/ensure-bun-workspace-install

RUN chmod +x /usr/local/bin/ensure-bun-workspace-install

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
	CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

CMD ["bash", "-lc", "ensure-bun-workspace-install && cd /app/apps/APIs && bun run db:push && bun run dev"]

FROM base AS production

ARG NODE_ENV=production

ENV NODE_ENV=${NODE_ENV}
ENV PORT=8000

RUN apt-get update \
	&& apt-get install -y --no-install-recommends wget \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=install-prod /app/node_modules ./node_modules
COPY --from=install-prod /app/apps/APIs/node_modules ./apps/APIs/node_modules
COPY --from=install-prod /app/packages/DB/node_modules ./packages/DB/node_modules
COPY --from=install-prod /app/packages/contracts/node_modules ./packages/contracts/node_modules

COPY --from=source /app/apps/APIs ./apps/APIs
COPY --from=source /app/packages/DB ./packages/DB
COPY --from=source /app/packages/contracts ./packages/contracts

WORKDIR /app/apps/APIs

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
	CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

CMD ["sh", "-c", "set -e; bun run db:push; bun run start"]
