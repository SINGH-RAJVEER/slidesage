FROM oven/bun:1.3.6 AS base

WORKDIR /app

# Copy all package.json files and lockfile
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/database/package.json ./packages/database/
COPY tsconfig.json ./

# Copy packages
COPY packages ./packages

# Install dependencies (from root to handle workspace)
RUN bun install

# Copy backend source code
COPY apps/backend ./apps/backend
COPY .env ./apps/backend/.env

# Switch to backend directory for runtime
WORKDIR /app/apps/backend

# Expose port
EXPOSE 8000

# Run migrations and start server
CMD ["sh", "-c", "bun run db:migrate && bun run start"]
