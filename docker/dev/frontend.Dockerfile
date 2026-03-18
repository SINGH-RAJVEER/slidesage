FROM oven/bun:1.3.6 AS development
WORKDIR /app

ENV BUN_INSTALL_CACHE_DIR=/root/.bun/install/cache

ARG NODE_ENV=development
ARG VITE_API_URL=http://localhost:8000
ARG VITE_PROXY_TARGET=http://localhost:8000

ENV NODE_ENV=${NODE_ENV}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PROXY_TARGET=${VITE_PROXY_TARGET}
ENV PORT=5173

COPY package.json ./
COPY bun.lock ./
COPY tsconfig.json ./
COPY turbo.json ./

COPY apps/Web/package.json ./apps/Web/package.json
COPY apps/APIs/package.json ./apps/APIs/package.json
COPY packages/DB/package.json ./packages/DB/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN --mount=type=cache,target=/root/.bun/install/cache \
	bun install --frozen-lockfile --ignore-scripts

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
	CMD bun -e "fetch('http://localhost:5173').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-lc", "cd /app/apps/Web && bun run dev --host 0.0.0.0"]
