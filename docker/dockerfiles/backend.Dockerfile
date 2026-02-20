# Multi-stage build for optimized APIs image
# Use Debian-based Bun image for better native-dependency compatibility.
FROM oven/bun:1.3.6 AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy all package.json files and lockfile
COPY package.json ./
COPY bun.lock ./
COPY apps/APIs/package.json ./apps/APIs/
COPY packages/DB/package.json ./packages/DB/

# Install dependencies with BuildKit cache mount for faster builds
# Omit optional deps to keep Docker builds reliable.
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --no-save --omit=optional

# Build the application
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/APIs/node_modules ./apps/APIs/node_modules

# Copy source code
COPY apps/APIs ./apps/APIs
COPY packages/DB ./packages/DB
COPY tsconfig.json ./

# Production image (no build needed - Bun runs TypeScript directly)
FROM oven/bun:1.3.6 AS runner
WORKDIR /app

# Tools used by Docker/Compose healthchecks
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

# Set production environment
ARG NODE_ENV=production
ENV NODE_ENV=production
ENV PORT=8000

# Copy application code and dependencies
COPY --from=deps /app/apps/APIs/node_modules ./apps/APIs/node_modules
COPY --from=builder /app/apps/APIs ./apps/APIs
COPY --from=builder /app/packages/DB ./packages/DB
COPY --from=builder /app/apps/APIs/package.json ./apps/APIs/

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Set working directory to APIs
WORKDIR /app/apps/APIs

# Run migrations and start server
CMD ["sh", "-c", "set -e; bun run db:push; bun run start"]
