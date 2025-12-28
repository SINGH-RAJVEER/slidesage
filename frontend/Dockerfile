FROM oven/bun:latest AS builder

WORKDIR /app

# Set API URL for build
ENV VITE_API_URL=http://localhost:8000

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Build the application
RUN bun run build

FROM oven/bun:latest

WORKDIR /app

# Copy package.json and install only vite for preview
COPY --from=builder /app/package.json /app/bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy built static site from builder stage
COPY --from=builder /app/dist /app/dist

EXPOSE 5173

# Serve the built static site using Vite preview
CMD ["bunx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
