FROM oven/bun:1.3.6 AS builder

WORKDIR /app

# Copy all package.json files and lockfile
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/database/package.json ./packages/database/
COPY tsconfig.json ./

# Copy packages
COPY packages ./packages

# Install dependencies
RUN bun install

# Copy source files
COPY apps/frontend ./apps/frontend
COPY .env ./apps/frontend/.env

# Build the application
WORKDIR /app/apps/frontend
RUN bun run build

FROM oven/bun:1.3.6

WORKDIR /app/apps/frontend

# Copy package.json and install only necessary deps
COPY --from=builder /app/apps/frontend/package.json ./
RUN bun install

# Copy built static site from builder stage
COPY --from=builder /app/apps/frontend/dist ./dist

EXPOSE 5173

# Serve the built static site using Vite preview
CMD ["bunx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]