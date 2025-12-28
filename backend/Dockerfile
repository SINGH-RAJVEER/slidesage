FROM nixos/nix:latest

# Enable nix flakes and nix-command
ENV NIX_CONFIG="experimental-features = nix-command flakes"

WORKDIR /app

# Copy backend sources
COPY . /app

# Expose Flask default port used in the flake
EXPOSE 8000

# Run the `uv` package defined in the backend flake which sets up a venv and starts Flask
CMD ["/bin/sh", "-c", "nix run .#uv"]
