# Multi-stage build for optimized backend image
# Use Debian-based Bun image for better native-dependency compatibility.
FROM oven/bun:1.3.6 AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy all package.json files and lockfile
COPY package.json ./
COPY bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/database/package.json ./apps/database/

# Install dependencies with BuildKit cache mount for faster builds
# Omit optional deps to keep Docker builds reliable.
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --no-save --omit=optional

# Build the application
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/apps/database/node_modules ./apps/database/node_modules

# Copy source code
COPY apps/database ./apps/database
COPY apps/backend ./apps/backend
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
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/apps/database/node_modules ./apps/database/node_modules
COPY --from=builder /app/apps/database ./apps/database
COPY --from=builder /app/apps/backend ./apps/backend
COPY --from=builder /app/apps/backend/package.json ./apps/backend/

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Set working directory to backend
WORKDIR /app/apps/backend

# Run migrations and start server
CMD ["sh", "-c", "cd /app/apps/database && bun run db:push && cd /app/apps/backend && bun run start"]
