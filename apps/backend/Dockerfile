FROM oven/bun:1 as base

WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Expose port
EXPOSE 8000

# Run migrations and start server
CMD ["sh", "-c", "bun run db:migrate && bun run start"]
