# Multi-stage build for optimized Web image
# Use Debian-based Bun image for better native-dependency compatibility.
FROM oven/bun:1.3.6 AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy all package.json files and lockfile
COPY package.json ./
COPY bun.lock ./
COPY apps/Web/package.json ./apps/Web/
COPY apps/APIs/package.json ./apps/APIs/

# Install dependencies with BuildKit cache mount for faster builds
# Skip lifecycle scripts to avoid failing optional native deps (e.g. node-canvas).
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --no-save --ignore-scripts

# Build the application
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/Web/node_modules ./apps/Web/node_modules
COPY --from=deps /app/apps/APIs/node_modules ./apps/APIs/node_modules

# Copy source code
COPY apps/Web ./apps/Web
COPY apps/APIs ./apps/APIs
COPY tsconfig.json ./

# Copy environment variables
ARG NODE_ENV=production
ARG VITE_API_URL=http://localhost:8000
ENV NODE_ENV=${NODE_ENV}
ENV VITE_API_URL=${VITE_API_URL}

# Build the Web application
WORKDIR /app/apps/Web
RUN bun run build

# Production image
FROM oven/bun:1.3.6 AS runner
WORKDIR /app

# Install wget for healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

# Set production environment
ENV NODE_ENV=production
ENV PORT=5173

# Copy built static files and serve with bun
COPY --from=builder /app/apps/Web/dist ./dist
COPY --from=builder /app/apps/Web/package.json ./package.json

# Expose port
EXPOSE 5173

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5173 || exit 1

# Start static file server using bun
CMD ["bun", "x", "serve", "dist", "-l", "5173"]
