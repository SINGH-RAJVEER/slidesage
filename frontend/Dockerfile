FROM nixos/nix:latest AS builder

# Enable nix flakes and nix-command
ENV NIX_CONFIG="experimental-features = nix-command flakes"

WORKDIR /app

# Copy frontend sources and build with nix
COPY . /app
RUN nix build .#packages.x86_64-linux.default -o /result --option sandbox false

FROM python:3.10-slim

WORKDIR /app

# Copy built static site from builder stage
COPY --from=builder /result /app

EXPOSE 8080

# Serve the built static site using Python's http.server
CMD ["python3", "-m", "http.server", "8080", "--directory", "/app"]
